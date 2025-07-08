// FILE: replicache/push.ts
import { Effect, Data } from "effect";
import type { PushRequest } from "replicache";
import { Db } from "../db/DbTag";
import { PokeService } from "../lib/server/PokeService";
import { serverLog } from "../lib/server/logger.server";
import type { ReplicacheClientId } from "../types/generated/public/ReplicacheClient";
import type { ReplicacheClientGroupId } from "../types/generated/public/ReplicacheClientGroup";
import type { UserId } from "../types/generated/public/User";
import { Schema } from "@effect/schema";
import { NoteIdSchema, UserIdSchema } from "../lib/shared/schemas";
import { Crypto } from "../lib/server/crypto";
import { toError } from "../lib/shared/toError";
import { createNote } from "../features/notes/createNote";
import { updateNote } from "../features/notes/updateNote";

/* -------------------------------------------------------------------------- */
/* Schemas                                                                    */
/* -------------------------------------------------------------------------- */
const CreateNoteMutationArgs = Schema.Struct({
  id: NoteIdSchema,
  title: Schema.String,
  content: Schema.String,
  user_id: UserIdSchema,
});
const UpdateNoteMutationArgs = Schema.Struct({
  id: NoteIdSchema,
  title: Schema.String,
  content: Schema.String,
});
/* -------------------------------------------------------------------------- */
/* Error Types                                                                */
/* -------------------------------------------------------------------------- */
class ReplicachePushError extends Data.TaggedError("ReplicachePushError")<{
  readonly cause: unknown;
}> {}

class MutationApplyError extends Data.TaggedError("MutationApplyError")<{
  readonly cause: unknown;
}> {}

/* -------------------------------------------------------------------------- */
/* Mutation Application Logic (Now calling features)                          */
/* -------------------------------------------------------------------------- */
const applyChange = (
  userId: UserId,
  change: { name: string; args: unknown },
): Effect.Effect<void, MutationApplyError, Db | Crypto | PokeService> => {
  switch (change.name) {
    case "createNote": {
      return Effect.gen(function* () {
        const args = yield* Schema.decodeUnknown(CreateNoteMutationArgs)(
          change.args,
        ).pipe(Effect.mapError((cause) => new MutationApplyError({ cause })));

        if (args.user_id !== userId) {
          return yield* Effect.fail(
            new MutationApplyError({
              cause: "Mutation user_id does not match authenticated user.",
            }),
          );
        }

        yield* createNote(args).pipe(
          Effect.mapError((cause) => new MutationApplyError({ cause })),
        );
      });
    }

    case "updateNote": {
      return Effect.gen(function* () {
        const args = yield* Schema.decodeUnknown(UpdateNoteMutationArgs)(
          change.args,
        ).pipe(Effect.mapError((cause) => new MutationApplyError({ cause })));

        yield* updateNote(args.id, userId, args).pipe(
          Effect.mapError((cause) => new MutationApplyError({ cause })),
        );
      });
    }

    default:
      return Effect.void;
  }
};
/* -------------------------------------------------------------------------- */
/* Main Handler (Simplified transaction handling)                             */
/* -------------------------------------------------------------------------- */
export const handlePush = (
  req: PushRequest,
  userId: UserId,
): Effect.Effect<void, ReplicachePushError, Db | PokeService | Crypto> =>
  Effect.gen(function* () {
    if (!("clientGroupID" in req)) {
      yield* serverLog(
        "error",
        "Push V0 not supported",
        userId,
        "Replicache:Push",
      );
      return;
    }

    const { clientGroupID, mutations: originalMutations } = req;
    if (originalMutations.length === 0) return;

    const mutations = [...originalMutations].sort((a, b) => a.id - b.id);
    const db = yield* Db;
    const pokeService = yield* PokeService;

    yield* serverLog(
      "info",
      `Processing ${mutations.length} mutations for clientGroupID: ${clientGroupID}`,
      userId,
      "Replicache:Push",
    );

    try {
      const clientID = mutations[0].clientID as ReplicacheClientId;

      yield* Effect.tryPromise({
        try: () =>
          db
            .insertInto("replicache_client_group")
            .values({
              id: clientGroupID as ReplicacheClientGroupId,
              user_id: userId,
            })
            .onConflict((oc) => oc.doNothing())
            .execute(),
        catch: (cause) => new ReplicachePushError({ cause }),
      });
      yield* Effect.tryPromise({
        try: () =>
          db
            .insertInto("replicache_client")
            .values({
              id: clientID,
              client_group_id: clientGroupID as ReplicacheClientGroupId,
            })
            .onConflict((oc) => oc.doNothing())
            .execute(),
        catch: (cause) => new ReplicachePushError({ cause }),
      });
      for (const mutation of mutations) {
        yield* Effect.tryPromise({
          try: () =>
            db
              .insertInto("change_log")
              .values({
                client_group_id: clientGroupID as ReplicacheClientGroupId,
                client_id: clientID,
                mutation_id: mutation.id,
                name: mutation.name,
                args: JSON.stringify(mutation.args),
              })
              .execute(),
          catch: (cause) => new ReplicachePushError({ cause }),
        });

        yield* applyChange(userId, mutation);
      }

      const lastMutationID = mutations[mutations.length - 1].id;
      yield* Effect.tryPromise({
        try: () =>
          db
            .updateTable("replicache_client")
            .set({ last_mutation_id: lastMutationID })
            .where("id", "=", clientID)
            .execute(),
        catch: (cause) => new ReplicachePushError({ cause }),
      });
    } catch (e) {
      yield* Effect.fail(new ReplicachePushError({ cause: e }));
    }

    yield* pokeService.poke(userId).pipe(
      Effect.catchAllDefect((defect) => {
        const error = toError(defect);
        return serverLog(
          "error",
          `Failed to send poke after push: ${error.message}`,
          userId,
          "Replicache:Push:Poke",
        );
      }),
    );
    yield* serverLog(
      "info",
      `Successfully processed push for clientGroupID: ${clientGroupID}`,
      userId,
      "Replicache:Push:Success",
    );
  }).pipe(
    Effect.catchAll((error) =>
      serverLog(
        "error",
        `Push failed: ${JSON.stringify(error)}`,
        undefined,
        "Replicache:Push:Failure",
      ),
    ),
  );
