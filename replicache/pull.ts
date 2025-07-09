// FILE: replicache/pull.ts
import { Data, Effect } from "effect";
import { type PatchOperation, type ReadonlyJSONValue } from "replicache";
import { Db } from "../db/DbTag";
import { serverLog } from "../lib/server/logger.server";
import { type Note, type NoteId } from "../types/generated/public/Note";
import { type Block, type BlockId } from "../types/generated/public/Block";
import { type UserId } from "../types/generated/public/User";
import { generateUUID } from "../lib/server/utils";
import { type ClientViewRecordId } from "../types/generated/public/ClientViewRecord";

// --- Types ---

class PullError extends Data.TaggedError("PullError")<{
  readonly cause: unknown;
}> {}

export interface PullRequest {
  clientGroupID: string;
  cookie: string | null;
}

type PullResponse = {
  cookie: string;
  lastMutationIDChanges: Record<string, number>;
  patch: PatchOperation[];
};

type CVR = Map<string, number>;

// --- Helper Functions ---

const toJSONSafe = (record: Note | Block): ReadonlyJSONValue => {
  // Use a type guard to differentiate between Note and Block
  if ("file_path" in record) {
    // This is a Block
    return {
      ...record,
      created_at: record.created_at.toISOString(),
      updated_at: record.updated_at.toISOString(),
      // Cast the `unknown` 'fields' property to what Replicache expects
      fields: record.fields as ReadonlyJSONValue,
    };
  }
  // This is a Note
  return {
    ...record,
    created_at: record.created_at.toISOString(),
    updated_at: record.updated_at.toISOString(),
  };
};

// --- Core CVR Logic Effects ---

const buildNextCVR = (userId: UserId): Effect.Effect<CVR, PullError, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const nextCVR = new Map<string, number>();

    const notes = yield* Effect.tryPromise({
      try: () =>
        db
          .selectFrom("note")
          .where("user_id", "=", userId)
          .select(["id", "version"])
          .execute(),
      catch: (cause) => new PullError({ cause }),
    });
    for (const note of notes) {
      nextCVR.set(`note/${note.id}`, note.version);
    }

    const blocks = yield* Effect.tryPromise({
      try: () =>
        db
          .selectFrom("block")
          .where("user_id", "=", userId)
          .select(["id", "version"])
          .execute(),
      catch: (cause) => new PullError({ cause }),
    });
    for (const block of blocks) {
      nextCVR.set(`block/${block.id}`, block.version);
    }

    return nextCVR;
  });

const fetchCVR = (
  cvrId: string | null,
): Effect.Effect<CVR | null, PullError, Db> =>
  Effect.gen(function* () {
    if (!cvrId) return null;
    const db = yield* Db;

    const cvrRecord = yield* Effect.tryPromise({
      try: () =>
        db
          .selectFrom("client_view_record")
          .where("id", "=", cvrId as ClientViewRecordId)
          .selectAll()
          .executeTakeFirst(),
      catch: (cause) => new PullError({ cause }),
    });

    if (!cvrRecord) return null;
    return new Map(Object.entries(cvrRecord.data as object)) as CVR;
  });

const storeCVR = (
  userId: UserId,
  cvr: CVR,
): Effect.Effect<string, PullError, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const cvrId = (yield* generateUUID()) as ClientViewRecordId;

    yield* Effect.tryPromise({
      try: () =>
        db
          .insertInto("client_view_record")
          .values({
            id: cvrId,
            user_id: userId,
            data: JSON.stringify(Object.fromEntries(cvr)),
          })
          .execute(),
      catch: (cause) => new PullError({ cause }),
    });
    return cvrId;
  });

const calculateDiff = (
  userId: UserId,
  oldCVR: CVR | null,
  nextCVR: CVR,
): Effect.Effect<PatchOperation[], PullError, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const patch: PatchOperation[] = [];

    if (oldCVR === null) {
      // New client, send full snapshot
      patch.push({ op: "clear" });
      const noteIds: NoteId[] = [];
      const blockIds: BlockId[] = [];
      for (const key of nextCVR.keys()) {
        if (key.startsWith("note/")) noteIds.push(key.substring(5) as NoteId);
        if (key.startsWith("block/"))
          blockIds.push(key.substring(6) as BlockId);
      }

      if (noteIds.length > 0) {
        const notes = yield* Effect.tryPromise({
          try: () =>
            db
              .selectFrom("note")
              .where("user_id", "=", userId) // <-- ADDED for security
              .where("id", "in", noteIds)
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
      }

      if (blockIds.length > 0) {
        const blocks = yield* Effect.tryPromise({
          try: () =>
            db
              .selectFrom("block")
              .where("user_id", "=", userId) // <-- ADDED for security
              .where("id", "in", blockIds)
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
      }
      return patch;
    }

    // Existing client, calculate delta
    const noteIdsToPut: NoteId[] = [];
    const blockIdsToPut: BlockId[] = [];

    for (const [key, nextVersion] of nextCVR.entries()) {
      const oldVersion = oldCVR.get(key);
      if (oldVersion === undefined || nextVersion > oldVersion) {
        if (key.startsWith("note/"))
          noteIdsToPut.push(key.substring(5) as NoteId);
        if (key.startsWith("block/"))
          blockIdsToPut.push(key.substring(6) as BlockId);
      }
    }

    for (const key of oldCVR.keys()) {
      if (!nextCVR.has(key)) {
        patch.push({ op: "del", key });
      }
    }

    if (noteIdsToPut.length > 0) {
      const notes = yield* Effect.tryPromise({
        try: () =>
          db
            .selectFrom("note")
            .where("user_id", "=", userId) // <-- ADDED for security
            .where("id", "in", noteIdsToPut)
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
    }

    if (blockIdsToPut.length > 0) {
      const blocks = yield* Effect.tryPromise({
        try: () =>
          db
            .selectFrom("block")
            .where("user_id", "=", userId) // <-- ADDED for security
            .where("id", "in", blockIdsToPut)
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
    }

    return patch;
  });

// --- Main Handler ---

export const handlePull = (
  userId: UserId,
  req: PullRequest,
): Effect.Effect<PullResponse, PullError, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const { clientGroupID, cookie: cvrId } = req;

    yield* serverLog(
      "info",
      `Processing pull for user: ${userId}, clientGroupID: ${clientGroupID}, cvrId: ${
        cvrId ?? "new client"
      }`,
      userId,
      "Replicache:Pull",
    );

    // Get lastMutationID changes (this logic is independent of CVRs)
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

    // CVR-based diffing
    const [oldCVR, nextCVR] = yield* Effect.all([
      fetchCVR(cvrId),
      buildNextCVR(userId),
    ]);

    const patch = yield* calculateDiff(userId, oldCVR, nextCVR);
    const nextCookie = yield* storeCVR(userId, nextCVR);

    return { lastMutationIDChanges, cookie: nextCookie, patch };
  });
