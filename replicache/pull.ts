// FILE: replicache/pull.ts

import { Data, Effect } from "effect";
import { type PatchOperation, type ReadonlyJSONValue } from "replicache";
import { Db } from "../db/DbTag";
import { serverLog } from "../lib/server/logger.server";
import type { ChangeLogId } from "../types/generated/public/ChangeLog";
import type { Block } from "../types/generated/public/Block";
import type { Note } from "../types/generated/public/Note";
import type { UserId } from "../types/generated/public/User";

// --- Error and Request/Response Types (Unchanged) ---

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

// --- Helper Functions (Unchanged) ---

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

// --- Refactored Smaller Effects (Unchanged) ---

/**
 * Creates a complete snapshot of all user data for a new client.
 */
const createInitialSnapshot = (
  userId: UserId,
): Effect.Effect<PatchOperation[], PullError, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const patch: PatchOperation[] = [{ op: "clear" }];

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

    return patch;
  });

/**
 * Creates a patch of changes that have occurred since the client's last pull.
 */
const createDeltaPatch = (
  userId: UserId,
  lastSeenVersion: number,
  serverVersion: number,
): Effect.Effect<PatchOperation[], PullError, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const patch: PatchOperation[] = [];

    const changes = yield* Effect.tryPromise({
      try: () =>
        db
          .selectFrom("change_log")
          .innerJoin(
            "replicache_client_group",
            "replicache_client_group.id",
            "change_log.client_group_id",
          )
          // This "where" clause is the critical fix.
          .where("replicache_client_group.user_id", "=", userId)
          .where("change_log.id", ">", String(lastSeenVersion) as ChangeLogId)
          .where("change_log.id", "<=", String(serverVersion) as ChangeLogId)
          .orderBy("change_log.id", "asc")
          // Explicitly select columns from change_log to avoid ambiguity.
          .selectAll("change_log")
          .execute(),
      catch: (cause) => new PullError({ cause }),
    });

    for (const change of changes) {
      const args = change.args as { id: string };
      if (change.name === "createNote" || change.name === "updateNote") {
        const note = yield* Effect.tryPromise({
          try: () =>
            db
              .selectFrom("note")
              .where("id", "=", args.id as Note["id"])
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

    return patch;
  });

// --- Main Handler (Corrected) ---

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

    const clients = yield* Effect.tryPromise({
      try: () =>
        db
          .selectFrom("replicache_client")
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

    const patch = yield* Effect.if(lastSeenVersion === 0, {
      onTrue: () =>
        Effect.gen(function* () {
          yield* serverLog(
            "info",
            "New client detected. Sending full snapshot.",
            userId,
            "Replicache:Pull",
          );
          return yield* createInitialSnapshot(userId);
        }),
      onFalse: () =>
        Effect.gen(function* () {
          if (lastSeenVersion === serverVersion) {
            yield* serverLog(
              "info",
              `Client is up-to-date at version ${serverVersion}`,
              userId,
              "Replicache:Pull",
            );
            return [];
          }
          yield* serverLog(
            "info",
            `Client is at version ${lastSeenVersion}. Sending changes up to ${serverVersion}.`,
            userId,
            "Replicache:Pull",
          );
          return yield* createDeltaPatch(
            userId,
            lastSeenVersion,
            serverVersion,
          );
        }),
    });

    return { lastMutationIDChanges, cookie: serverVersion, patch };
  });
