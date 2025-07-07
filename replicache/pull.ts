// File: replicache/pull.ts
import { Effect, Data } from "effect";
import { type ReadonlyJSONValue, type PatchOperation } from "replicache";
import { Db } from "../db/DbTag";
import { serverLog } from "../lib/server/logger.server";
import type { Block } from "../types/generated/public/Block";
import type { Note, NoteId } from "../types/generated/public/Note";
import type { UserId } from "../types/generated/public/User";
import type { ChangeLogId } from "../types/generated/public/ChangeLog";
class PullError extends Data.TaggedError("PullError")<{
  readonly cause: unknown;
}> {}

export interface PullRequest {
  clientGroupID: string;
  cookie: ReadonlyJSONValue | null;
}

type PullResponse = {
  cookie: number;
  lastMutationIDChanges: Record<string, number>;
  patch: PatchOperation[];
};

function isBlock(record: Note | Block): record is Block {
  return "file_path" in record;
}

const toJSONSafe = (record: Note | Block): ReadonlyJSONValue => {
  if (isBlock(record)) {
    const { fields, ...rest } = record;
    return {
      ...rest,
      created_at: record.created_at.toISOString(),
      updated_at: record.updated_at.toISOString(),
      fields: fields as ReadonlyJSONValue,
    };
  } else {
    return {
      ...record,
      created_at: record.created_at.toISOString(),
      updated_at: record.updated_at.toISOString(),
    };
  }
};

export const handlePull = (
  userId: UserId,
  req: PullRequest,
): Effect.Effect<PullResponse, PullError, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const { clientGroupID } = req;
    const lastSeenVersion = typeof req.cookie === "number" ? req.cookie : 0;

    yield* serverLog(
      "info",
      `Processing pull for user: ${userId}, clientGroupID: ${clientGroupID}, version: ${lastSeenVersion}`,
      userId,
      "Replicache:Pull",
    );

    const serverVersionResult = yield* Effect.tryPromise({
      try: () =>
        db
          .selectFrom("change_log")
          .select(db.fn.max("id").as("max_id"))
          .executeTakeFirst(),
      catch: (cause) => new PullError({ cause }),
    });

    const serverVersion = serverVersionResult?.max_id
      ? parseInt(String(serverVersionResult.max_id), 10)
      : 0;

    // --- START OF FIX ---

    // If the client is already up-to-date, return an empty changes map.
    if (lastSeenVersion === serverVersion) {
      yield* serverLog(
        "info",
        `Client is up-to-date at version ${serverVersion}`,
        userId,
        "Replicache:Pull",
      );
      return { lastMutationIDChanges: {}, cookie: serverVersion, patch: [] };
    }

    // This logic now only runs if the client is behind the server.
    const clients = yield* Effect.tryPromise({
      try: () =>
        db
          .selectFrom("replicache_client")
          // Correctly join to find all clients for the current USER, not just the current client group.
          .innerJoin(
            "replicache_client_group",
            "replicache_client.client_group_id",
            "replicache_client_group.id",
          )
          .where("replicache_client_group.user_id", "=", userId)
          .select([
            "replicache_client.id",
            "replicache_client.last_mutation_id as lastMutationID",
          ])
          .execute(),
      catch: (cause) => new PullError({ cause }),
    });

    const lastMutationIDChanges = clients.reduce<Record<string, number>>(
      (acc, client) => {
        acc[client.id] = client.lastMutationID;
        return acc;
      },
      {},
    );

    // --- END OF FIX ---

    const patch: PullResponse["patch"] = [];
    if (lastSeenVersion === 0) {
      yield* serverLog(
        "info",
        "New client detected. Sending full snapshot.",
        userId,
        "Replicache:Pull",
      );
      patch.push({ op: "clear" });

      const notes = yield* Effect.tryPromise({
        try: () =>
          db
            .selectFrom("note")
            .where("user_id", "=", userId)
            .selectAll()
            .execute(),
        catch: (cause) => new PullError({ cause }),
      });
      for (const note of notes) {
        patch.push({
          op: "put",
          key: `note/${note.id}`,
          value: toJSONSafe(note),
        });
      }

      const blocks = yield* Effect.tryPromise({
        try: () =>
          db
            .selectFrom("block")
            .where("user_id", "=", userId)
            .selectAll()
            .execute(),
        catch: (cause) => new PullError({ cause }),
      });
      for (const block of blocks) {
        patch.push({
          op: "put",
          key: `block/${block.id}`,
          value: toJSONSafe(block),
        });
      }
    } else {
      yield* serverLog(
        "info",
        `Client is at version ${lastSeenVersion}. Sending changes up to ${serverVersion}.`,
        userId,
        "Replicache:Pull",
      );
      const changes = yield* Effect.tryPromise({
        try: () =>
          db
            .selectFrom("change_log")
            .where("id", ">", String(lastSeenVersion) as ChangeLogId)
            .where("id", "<=", String(serverVersion) as ChangeLogId)
            .orderBy("id", "asc")
            .selectAll()
            .execute(),
        catch: (cause) => new PullError({ cause }),
      });
      for (const change of changes) {
        const args = change.args as {
          id: string;
          title?: string;
          content?: string;
        };
        if (change.name === "createNote" || change.name === "updateNote") {
          const note = yield* Effect.tryPromise({
            try: () =>
              db
                .selectFrom("note")
                .where("id", "=", args.id as NoteId)
                .selectAll()
                .executeTakeFirstOrThrow(),
            catch: (cause) => new PullError({ cause }),
          });
          patch.push({
            op: "put",
            key: `note/${args.id}`,
            value: toJSONSafe(note),
          });
        }
      }
    }

    return { lastMutationIDChanges, cookie: serverVersion, patch };
  });
