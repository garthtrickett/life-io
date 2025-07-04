// File: replicache/pull.ts
import { Effect, Data } from "effect"; // Import Data
import type { ReadonlyJSONValue } from "replicache";
import { Db } from "../db/DbTag";
import { serverLog } from "../lib/server/logger.server";
import type { Block } from "../types/generated/public/Block";
import type { Note } from "../types/generated/public/Note";
import type { ReplicacheClientGroupId } from "../types/generated/public/ReplicacheClientGroup";
import type { UserId } from "../types/generated/public/User";

// --- NEW Tagged Error ---
class PullError extends Data.TaggedError("PullError")<{
  readonly cause: unknown;
}> {}

// --- Types (Specific to Pull) ---
/** Shape of the incoming Pull request. Exported for use in the main server. */
export interface PullRequest {
  clientGroupID: string;
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
  lastMutationIDChanges: Record<string, number>;
  cookie: number;
  patch: (
    | { op: "put"; key: string; value: JsonSafeNote | JsonSafeBlock }
    | { op: "del"; key: string }
    | { op: "clear" }
  )[];
}
// ---------------------------------------------------------------------------
// Pull Handler
// ---------------------------------------------------------------------------
export const handlePull = (
  userId: UserId,
  req: PullRequest,
): Effect.Effect<PullResponse, PullError, Db> => // Updated error type
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
      // Use the new tagged error
      catch: (cause) => new PullError({ cause }),
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
      // Use the new tagged error
      catch: (cause) => new PullError({ cause }),
    });

    const lastMutationIDChanges = clients.reduce<Record<string, number>>(
      (acc, client) => {
        acc[client.id] = client.lastMutationID;
        return acc;
      },
      {},
    );

    const serverVersion = clientGroup.cvr_version;

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
        patch: [],
      };
    }

    const notes = yield* Effect.tryPromise({
      try: () =>
        db
          .selectFrom("note")
          .where("user_id", "=", userId)
          .selectAll()
          .execute(),
      // Use the new tagged error
      catch: (cause) => new PullError({ cause }),
    });

    const blocks = yield* Effect.tryPromise({
      try: () =>
        db
          .selectFrom("block")
          .where("user_id", "=", userId)
          .selectAll()
          .execute(),
      // Use the new tagged error
      catch: (cause) => new PullError({ cause }),
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
