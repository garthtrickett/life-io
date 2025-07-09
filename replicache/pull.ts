// FILE: replicache/pull.ts
import { Data, Effect } from "effect";
import { type PatchOperation, type ReadonlyJSONValue } from "replicache";
import { Db } from "../db/DbTag";
import { serverLog } from "../lib/server/logger.server";
import { type Note, type NoteId } from "../types/generated/public/Note";
import { type Block, type BlockId } from "../types/generated/public/Block";
import { type UserId } from "../types/generated/public/User";
import { type ClientViewRecordId } from "../types/generated/public/ClientViewRecord";

// --- Types ---

class PullError extends Data.TaggedError("PullError")<{
  readonly cause: unknown;
}> {}

export interface PullRequest {
  clientGroupID: string;
  cookie: unknown; // Receive cookie as unknown for safe parsing
}

type PullResponse = {
  cookie: number;
  lastMutationIDChanges: Record<string, number>;
  patch: PatchOperation[];
};

type CVR = Map<string, number>;

// --- Helper Functions (Unchanged) ---

const toJSONSafe = (record: Note | Block): ReadonlyJSONValue => {
  if ("file_path" in record) {
    return {
      ...record,
      created_at: record.created_at.toISOString(),
      updated_at: record.updated_at.toISOString(),
      fields: record.fields as ReadonlyJSONValue,
    };
  }
  return {
    ...record,
    created_at: record.created_at.toISOString(),
    updated_at: record.updated_at.toISOString(),
  };
};

const compareCVRs = (a: CVR | null, b: CVR | null): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.size !== b.size) return false;
  for (const [key, val] of a) {
    if (b.get(key) !== val) return false;
  }
  return true;
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
  cvrId: number | null,
): Effect.Effect<CVR | null, PullError, Db> =>
  Effect.gen(function* () {
    if (cvrId === null) return null;
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
): Effect.Effect<number, PullError, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;

    const result = yield* Effect.tryPromise({
      try: () =>
        db
          .insertInto("client_view_record")
          .values({
            user_id: userId,
            data: JSON.stringify(Object.fromEntries(cvr)),
          })
          .returning("id")
          .executeTakeFirstOrThrow(),
      catch: (cause) => new PullError({ cause }),
    });
    return result.id;
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
              .where("user_id", "=", userId)
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
              .where("user_id", "=", userId)
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
            .where("user_id", "=", userId)
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
            .where("user_id", "=", userId)
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
    const { clientGroupID } = req;
    // Safely parse the cookie
    const cvrId =
      typeof req.cookie === "number" && Number.isInteger(req.cookie)
        ? req.cookie
        : null;

    yield* serverLog(
      "info",
      { userId, clientGroupID, cvrId: cvrId ?? "new client" },
      "Processing pull request",
      "Replicache:Pull",
    );

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

    const [oldCVR, nextCVR] = yield* Effect.all([
      fetchCVR(cvrId),
      buildNextCVR(userId),
    ]);

    if (cvrId !== null && compareCVRs(oldCVR, nextCVR)) {
      yield* serverLog(
        "info",
        { userId },
        "CVR is unchanged. Returning same cookie and LMID changes.",
        "Replicache:Pull:NoChange",
      );
      return {
        lastMutationIDChanges,
        cookie: cvrId,
        patch: [],
      };
    }

    const patch = yield* calculateDiff(userId, oldCVR, nextCVR);
    const nextCookie = yield* storeCVR(userId, nextCVR);

    return { lastMutationIDChanges, cookie: nextCookie, patch };
  });
