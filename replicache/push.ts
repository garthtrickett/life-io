// replicache/push.ts
import { Effect, Data } from "effect";
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
import { Crypto } from "../lib/server/crypto";
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
/* Mutation Application Logic                                                 */
/* -------------------------------------------------------------------------- */
/**
 * This function contains the business logic for applying a mutation from the
 * change_log to the materialized `note` and `block` tables.
 */
const applyChange = (
  trx: Transaction<Database>,
  userId: UserId,
  change: { name: string; args: unknown },
): Effect.Effect<void, MutationApplyError, Crypto> =>
  Effect.tryPromise({
    try: async () => {
      switch (change.name) {
        case "createNote": {
          const args = Schema.decodeUnknownSync(CreateNoteMutationArgs)(
            change.args,
          );
          if (args.user_id !== userId) {
            throw new Error(
              "Mutation user_id does not match authenticated user.",
            );
          }
          const newNote: NewNote = {
            id: args.id,
            title: args.title,
            content: args.content,
            user_id: args.user_id,
          };
          // Idempotent insert
          await trx
            .insertInto("note")
            .values(newNote)
            .onConflict((oc) => oc.column("id").doNothing())
            .execute();
          break;
        }

        case "updateNote": {
          const args = Schema.decodeUnknownSync(UpdateNoteMutationArgs)(
            change.args,
          );
          const parentNote = await trx
            .updateTable("note")
            .set({
              title: args.title,
              content: args.content,
              updated_at: new Date(),
            })
            .where("id", "=", args.id)
            .where("user_id", "=", userId)
            .returningAll()
            .executeTakeFirst();
          if (!parentNote) break;
          await trx
            .deleteFrom("block")
            .where("note_id", "=", args.id)
            .execute();
          const childBlocks = await Effect.runPromise(
            parseMarkdownToBlocks(
              args.content,
              `${parentNote.id}.md`,
              userId,
              args.id,
            ),
          );
          if (childBlocks.length > 0) {
            await trx.insertInto("block").values(childBlocks).execute();
          }
          break;
        }
      }
    },
    catch: (cause) => new MutationApplyError({ cause }),
  });
/* -------------------------------------------------------------------------- */
/* Main Handler                                                               */
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

    // The entire push operation is one large transaction.
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
            // 1. Write to the append-only log.
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
            // ======================== START OF FIX ========================
            // 2. Apply the change to the materialized view synchronously.
            //    Use `await` here because we are inside a native `async` function.
            await Effect.runPromise(
              Effect.provideService(
                applyChange(trx, userId, mutation),
                Crypto,
                crypto,
              ),
            );
            // ========================= END OF FIX =========================
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
    // --- DEBUG-F ---
    yield* serverLog(
      "debug",
      `[DEBUG-F] Push transaction complete for ${clientGroupID}. About to call poke service.`,
      userId,
      "Replicache:Push:PokeDebug",
    );

    // 5. Poke clients to notify them of new changes.
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
