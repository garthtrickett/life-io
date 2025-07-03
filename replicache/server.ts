import { Effect } from "effect";
import { Db } from "../db/DbTag";
import type { PushRequest } from "replicache";
import { serverLog } from "../lib/server/logger.server";
import type { UserId } from "../types/generated/public/User";
import type { Block } from "../types/generated/public/Block";
import type { Note } from "../types/generated/public/Note";
import type { ReplicacheClientGroupId } from "../types/generated/public/ReplicacheClientGroup";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of the incoming Pull request. */
interface PullRequest {
  clientGroupID: string;
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

// ---------------------------------------------------------------------------
// Pull handler
// ---------------------------------------------------------------------------

export const handlePull = (
  userId: UserId,
  req: PullRequest,
): Effect.Effect<PullResponse, Error, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const { clientGroupID } = req;

    yield* serverLog(
      "info",
      `Processing pull for user: ${userId}, clientGroupID: ${clientGroupID}`,
      userId,
      "Replicache:Pull",
    );

    // ---------------------------------------------------------------------
    // Ensure a client‑group row exists (create if missing)
    // ---------------------------------------------------------------------
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

    // ---------------------------------------------------------------------
    // Fetch all rows that belong to the user
    // ---------------------------------------------------------------------
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
      `[Replicache:Pull] Fetched ${notes.length} notes and ${blocks.length} blocks from database.`,
      userId,
      "Replicache:Pull",
    );

    // ---------------------------------------------------------------------
    // Build the patch – full snapshot strategy (clear + puts)
    // ---------------------------------------------------------------------
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

    // ---------------------------------------------------------------------
    // Assemble response – v1 shape
    // ---------------------------------------------------------------------
    const pullResponse: PullResponse = {
      lastMutationIDChanges: {
        // TODO: populate real per‑client values.
        [clientGroupID]: 0,
      },
      cookie: clientGroup.cvr_version,
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
// Push handler (unchanged)
// ---------------------------------------------------------------------------

export const handlePush = (
  req: PushRequest,
  userId: UserId,
): Effect.Effect<void, Error, Db> =>
  Effect.gen(function* () {
    yield* serverLog(
      "info",
      `Processing push for user: ${userId}`,
      userId,
      "Replicache:Push",
    );

    for (const mutation of req.mutations) {
      yield* serverLog(
        "debug",
        `  Mutation: ${mutation.name}`,
        userId,
        "Replicache:Push",
      );
    }

    yield* pokeClients();
  });

export const pokeClients = () =>
  serverLog("info", "Poking clients...", undefined, "Replicache:Poke");
