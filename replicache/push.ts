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
import type { NewNote } from "../types/generated/public/Note";
import { Crypto } from "../lib/server/crypto";
import { parseMarkdownToBlocks } from "../lib/server/parser";

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

class ReplicachePushError extends Data.TaggedError("ReplicachePushError")<{
  readonly cause: unknown;
}> {}

const getLastMutationID = (
  req: PushRequest,
): Effect.Effect<number, Error, never> =>
  Effect.try(() => req.mutations.reduce((max, m) => Math.max(max, m.id), 0));

export const handlePush = (
  req: PushRequest,
  userId: UserId,
): Effect.Effect<void, Error, Db | PokeService | Crypto> =>
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

    const transactionEffect = Effect.tryPromise({
      try: () =>
        db.transaction().execute(async (trx) => {
          for (const mutation of mutations) {
            await Effect.runPromise(
              serverLog(
                "debug",
                `  Processing mutation: ${mutation.name} (id: ${mutation.id})`,
                userId,
                "Replicache:Push:Mutation",
              ),
            );
            switch (mutation.name) {
              case "createNote": {
                const args = Schema.decodeUnknownSync(CreateNoteMutationArgs)(
                  mutation.args,
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
                await trx.insertInto("note").values(newNote).execute();
                break;
              }
              case "updateNote": {
                const args = Schema.decodeUnknownSync(UpdateNoteMutationArgs)(
                  mutation.args,
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
                  .executeTakeFirstOrThrow();
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
          }

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
      catch: (e) => new ReplicachePushError({ cause: e }),
    });

    // --- START OF FIX ---
    // The problematic `.pipe(Effect.mapError(...))` has been removed.
    // We now let the original `ReplicachePushError` flow through.
    yield* transactionEffect.pipe(
      Effect.tap(() =>
        serverLog(
          "info",
          `Successfully processed push transaction for clientGroupID: ${clientGroupID}`,
          userId,
          "Replicache:Push:Success",
        ),
      ),
      Effect.tapError((e) =>
        serverLog(
          "error",
          `Push transaction failed for clientGroupID: ${clientGroupID}. Error: ${
            (e.cause as Error)?.message || "Unknown cause"
          }`,
          userId,
          "Replicache:Push:Failure",
        ),
      ),
    );
    // --- END OF FIX ---

    yield* pokeService.poke();
  });
