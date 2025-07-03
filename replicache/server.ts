// replicache/server.ts
import { Effect } from "effect";
import { Db } from "../db/DbTag";
import type { PushRequest, ReadonlyJSONValue } from "replicache";
import { serverLog } from "../lib/server/logger.server";
import type { UserId } from "../types/generated/public/User";
import type { Block } from "../types/generated/public/Block";
import type { Note } from "../types/generated/public/Note";
import type { ReplicacheClientGroupId } from "../types/generated/public/ReplicacheClientGroup";
import type { ReplicacheClientId } from "../types/generated/public/ReplicacheClient";
import { PokeService } from "../lib/server/PokeService";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of the incoming Pull request. */
interface PullRequest {
  clientGroupID: string;
  // FIX: The client sends its last known version (cookie). It can be null.
  cookie: ReadonlyJSONValue | null;
}

/** A JSON‑safe Note (dates → ISO strings). */
type JsonSafeNote = Omit<Note, "created_at" | "updated_at"> & {
  created_at: string;
  updated_at: string;
};

/** A JSON‑safe Block (dates → ISO strings). */
type JsonSafeBlock = Omit<Block, "created_at" | "updated_at"> & {
  created_at: string;
  updated_at: string;
};

/** Replicache PullResponse for protocol **v1**. */
interface PullResponse {
  /** Map of clientID → lastMutationID. REQUIRED in v1. */
  lastMutationIDChanges: Record<string, number>;
  /** Any JSON‑safe value that lets the client detect staleness. */
  cookie: number;
  /** Patch operations that bring the client to the current state. */
  patch: (
    | { op: "put"; key: string; value: JsonSafeNote | JsonSafeBlock }
    | { op: "del"; key: string }
    | { op: "clear" }
  )[];
}

// --- Helper to get the highest mutation ID from a push request ---
const getLastMutationID = (
  req: PushRequest,
): Effect.Effect<number, Error, never> =>
  Effect.try(() => req.mutations.reduce((max, m) => Math.max(max, m.id), 0));

// ---------------------------------------------------------------------------
// Pull handler
// ---------------------------------------------------------------------------

export const handlePull = (
  userId: UserId,
  req: PullRequest,
): Effect.Effect<PullResponse, Error, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;

    const { clientGroupID, cookie } = req;
    const requestCookie = typeof cookie === "number" ? cookie : null;

    yield* serverLog(
      "info",
      `Processing pull for user: ${userId}, clientGroupID: ${clientGroupID}, cookie: ${requestCookie}`,
      userId,
      "Replicache:Pull",
    );

    const clientGroup = yield* Effect.tryPromise({
      try: async () => {
        let group = await db
          .selectFrom("replicache_client_group")
          .where("id", "=", clientGroupID as ReplicacheClientGroupId)
          .where("user_id", "=", userId)
          .selectAll()
          .executeTakeFirst();

        if (!group) {
          group = await db
            .insertInto("replicache_client_group")
            .values({
              id: clientGroupID as ReplicacheClientGroupId,
              user_id: userId,
              cvr_version: 0,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        }
        return group;
      },
      catch: (e) => new Error(String(e)),
    });

    const clients = yield* Effect.tryPromise({
      try: () =>
        db
          .selectFrom("replicache_client")
          .where(
            "client_group_id",
            "=",
            clientGroupID as ReplicacheClientGroupId,
          )
          .select(["id", "last_mutation_id as lastMutationID"])
          .execute(),
      catch: (e) => new Error(String(e)),
    });

    const lastMutationIDChanges = clients.reduce<Record<string, number>>(
      (acc, client) => {
        acc[client.id] = client.lastMutationID;
        return acc;
      },
      {},
    );

    const serverVersion = clientGroup.cvr_version;

    // --- FIX: Check if the client is already up-to-date ---
    if (requestCookie === serverVersion) {
      yield* serverLog(
        "info",
        `[Replicache:Pull] Client is already up-to-date. Cookie: ${serverVersion}`,
        userId,
        "Replicache:Pull",
      );
      return {
        lastMutationIDChanges,
        cookie: serverVersion,
        patch: [], // Return an empty patch
      };
    }

    const notes = yield* Effect.tryPromise({
      try: () =>
        db
          .selectFrom("note")
          .where("user_id", "=", userId)
          .selectAll()
          .execute(),
      catch: (e) => new Error(String(e)),
    });

    const blocks = yield* Effect.tryPromise({
      try: () =>
        db
          .selectFrom("block")
          .where("user_id", "=", userId)
          .selectAll()
          .execute(),
      catch: (e) => new Error(String(e)),
    });

    yield* serverLog(
      "debug",
      `[Replicache:Pull] Client is stale. Sending snapshot. Fetched ${notes.length} notes and ${blocks.length} blocks.`,
      userId,
      "Replicache:Pull",
    );

    const patch: PullResponse["patch"] = [{ op: "clear" }];

    for (const note of notes) {
      patch.push({
        op: "put",
        key: `note/${note.id}`,
        value: {
          ...note,
          created_at: note.created_at.toISOString(),
          updated_at: note.updated_at.toISOString(),
        },
      });
    }

    for (const block of blocks) {
      patch.push({
        op: "put",
        key: `block/${block.id}`,
        value: {
          ...block,
          created_at: block.created_at.toISOString(),
          updated_at: block.updated_at.toISOString(),
        },
      });
    }

    const pullResponse: PullResponse = {
      lastMutationIDChanges,
      cookie: serverVersion,
      patch,
    };

    yield* serverLog(
      "debug",
      `[Replicache:Pull] Constructed pull response (ops: ${patch.length}). Cookie: ${pullResponse.cookie}.`,
      userId,
      "Replicache:Pull",
    );

    return pullResponse;
  });

// ---------------------------------------------------------------------------
// Push handler
// ---------------------------------------------------------------------------

export const handlePush = (
  req: PushRequest,
  userId: UserId,
): Effect.Effect<void, Error, Db | PokeService> =>
  Effect.gen(function* () {
    if (!("clientGroupID" in req)) {
      yield* serverLog(
        "error",
        "Push request received with unsupported V0 protocol.",
        userId,
        "Replicache:Push",
      );
      return;
    }

    const { clientGroupID, mutations } = req;

    if (mutations.length === 0) {
      yield* serverLog(
        "warn",
        `Push request received with no mutations for clientGroupID: ${clientGroupID}`,
        userId,
        "Replicache:Push",
      );
      return;
    }

    const clientID = mutations[0].clientID;
    const db = yield* Db;
    const pokeService = yield* PokeService;

    yield* serverLog(
      "info",
      `Processing push for user: ${userId}, clientGroupID: ${clientGroupID}, clientID: ${clientID}`,
      userId,
      "Replicache:Push",
    );

    const lastMutationID = yield* getLastMutationID(req);

    yield* Effect.tryPromise({
      try: () =>
        db.transaction().execute(async (trx) => {
          await trx
            .insertInto("replicache_client")
            .values({
              id: clientID as ReplicacheClientId,
              client_group_id: clientGroupID as ReplicacheClientGroupId,
              last_mutation_id: lastMutationID,
            })
            .onConflict((oc) =>
              oc.column("id").doUpdateSet({ last_mutation_id: lastMutationID }),
            )
            .execute();

          await trx
            .updateTable("replicache_client_group")
            .set((eb) => ({
              cvr_version: eb("cvr_version", "+", 1),
            }))
            .where("id", "=", clientGroupID as ReplicacheClientGroupId)
            .execute();
        }),
      catch: (e) => new Error(String(e)),
    });

    for (const mutation of req.mutations) {
      yield* serverLog(
        "debug",
        `  Mutation processed: ${mutation.name} (id: ${mutation.id})`,
        userId,
        "Replicache:Push",
      );
    }

    yield* pokeService.poke();
  });
