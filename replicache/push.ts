// FILE: replicache/push.ts
import { Effect, Data, pipe } from "effect";
import type { PushRequest } from "replicache";
import type { Transaction } from "kysely";
import { Db } from "../db/DbTag";
import { PokeService } from "../lib/server/PokeService";
import { serverLog } from "../lib/server/logger.server";
import type { ReplicacheClientId } from "../types/generated/public/ReplicacheClient";
import type { ReplicacheClientGroupId } from "../types/generated/public/ReplicacheClientGroup";
import type { UserId } from "../types/generated/public/User";
import { Schema } from "@effect/schema";
import { NoteIdSchema, UserIdSchema } from "../lib/shared/schemas";
import type { NewNote } from "../types/generated/public/Note";
import { Crypto } from "../lib/server/crypto"; // Re-added this import
import { parseMarkdownToBlocks } from "../lib/server/parser";
import type { Database } from "../types";
import { toError } from "../lib/shared/toError";

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
/* Mutation Application Logic (Reverted to Effect-based)                      */
/* -------------------------------------------------------------------------- */
const applyChange = (
  trx: Transaction<Database>,
  userId: UserId,
  change: { name: string; args: unknown },
): Effect.Effect<void, MutationApplyError, never> => {
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

        const newNote: NewNote = {
          id: args.id,
          title: args.title,
          content: args.content,
          user_id: args.user_id,
        };

        yield* Effect.tryPromise({
          try: () =>
            trx
              .insertInto("note")
              .values(newNote)
              .onConflict((oc) => oc.column("id").doNothing())
              .execute(),
          catch: (cause) => new MutationApplyError({ cause }),
        });

        // ======================== START OF FIX ========================
        const childBlocks = yield* parseMarkdownToBlocks(
          args.content,
          `${args.id}.md`,
          userId,
          args.id,
        );

        if (childBlocks.length > 0) {
          yield* Effect.tryPromise({
            try: () =>
              trx
                .insertInto("block")
                .values(childBlocks)
                .onConflict((oc) => oc.doNothing())
                .execute(),
            catch: (cause) => new MutationApplyError({ cause }),
          });
        }
        // ========================= END OF FIX =========================
      });
    }

    case "updateNote": {
      return Effect.gen(function* () {
        const args = yield* Schema.decodeUnknown(UpdateNoteMutationArgs)(
          change.args,
        ).pipe(Effect.mapError((cause) => new MutationApplyError({ cause })));

        const parentNote = yield* Effect.tryPromise({
          try: () =>
            trx
              .updateTable("note")
              .set({
                title: args.title,
                content: args.content,
                updated_at: new Date(),
              })
              .where("id", "=", args.id)
              .where("user_id", "=", userId)
              .returningAll()
              .executeTakeFirst(),
          catch: (cause) => new MutationApplyError({ cause }),
        });

        if (!parentNote) return;

        yield* Effect.tryPromise({
          try: () =>
            trx.deleteFrom("block").where("note_id", "=", args.id).execute(),
          catch: (cause) => new MutationApplyError({ cause }),
        });

        const childBlocks = yield* parseMarkdownToBlocks(
          args.content,
          `${parentNote.id}.md`,
          userId,
          args.id,
        );

        if (childBlocks.length > 0) {
          yield* Effect.tryPromise({
            try: () => trx.insertInto("block").values(childBlocks).execute(),
            catch: (cause) => new MutationApplyError({ cause }),
          });
        }
      });
    }

    default:
      return Effect.void;
  }
};

/* -------------------------------------------------------------------------- */
/* Main Handler (Reverted to original structure)                              */
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
    const crypto = yield* Crypto;

    yield* serverLog(
      "info",
      `Processing ${mutations.length} mutations for clientGroupID: ${clientGroupID}`,
      userId,
      "Replicache:Push",
    );

    yield* Effect.tryPromise({
      try: () =>
        db.transaction().execute(async (trx) => {
          const clientID = mutations[0].clientID as ReplicacheClientId;

          await trx
            .insertInto("replicache_client_group")
            .values({
              id: clientGroupID as ReplicacheClientGroupId,
              user_id: userId,
            })
            .onConflict((oc) => oc.doNothing())
            .execute();

          await trx
            .insertInto("replicache_client")
            .values({
              id: clientID,
              client_group_id: clientGroupID as ReplicacheClientGroupId,
            })
            .onConflict((oc) => oc.doNothing())
            .execute();

          for (const mutation of mutations) {
            await trx
              .insertInto("change_log")
              .values({
                client_group_id: clientGroupID as ReplicacheClientGroupId,
                client_id: clientID,
                mutation_id: mutation.id,
                name: mutation.name,
                args: JSON.stringify(mutation.args),
              })
              .execute();

            await Effect.runPromise(
              pipe(
                applyChange(trx, userId, mutation),
                Effect.provideService(Crypto, crypto), // Provide the crypto service
              ),
            );
          }

          const lastMutationID = mutations[mutations.length - 1].id;
          await trx
            .updateTable("replicache_client")
            .set({ last_mutation_id: lastMutationID })
            .where("id", "=", clientID)
            .execute();
        }),
      catch: (cause) => new ReplicachePushError({ cause }),
    });

    yield* pokeService.poke().pipe(
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
