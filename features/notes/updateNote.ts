// FILE: features/notes/updateNote.ts
import { Effect, pipe } from "effect";
import { Db } from "../../db/DbTag";
import type { Note } from "../../types/generated/public/Note";
import { serverLog } from "../../lib/server/logger.server";
import { validateNoteId, validateUserId } from "../../lib/shared/domain";
import {
  NoteDatabaseError,
  NoteNotFoundError,
  NoteValidationError,
} from "./Errors";
import { Schema } from "@effect/schema";
import { NoteSchema } from "../../lib/shared/schemas";
import { parseMarkdownToBlocks } from "../../lib/server/parser";
// FIX: Changed from 'import type' to a value import
import { Crypto } from "../../lib/server/crypto";

interface NoteUpdatePayload {
  title: string;
  content: string; // This will be the raw markdown
}

export const updateNote = (
  noteId: string,
  userId: string,
  noteUpdate: NoteUpdatePayload,
): Effect.Effect<
  Note,
  NoteDatabaseError | NoteNotFoundError | NoteValidationError,
  Db | Crypto // This effect now correctly requires Crypto
> =>
  Effect.gen(function* () {
    const validatedNoteId = yield* validateNoteId(noteId).pipe(
      Effect.mapError((cause) => new NoteValidationError({ cause })),
    );
    const validatedUserId = yield* validateUserId(userId).pipe(
      Effect.mapError((cause) => new NoteValidationError({ cause })),
    );
    const db = yield* Db;
    // Get the crypto service from the context to be used inside the transaction
    const crypto = yield* Crypto;

    yield* Effect.forkDaemon(
      serverLog(
        "info",
        `[updateNote] Parsing and updating note. ID: "${validatedNoteId}"`,
        validatedUserId,
        "UpdateNote",
      ),
    );

    // This effect encapsulates the entire database transaction.
    // We use `Effect.tryPromise` to correctly handle the async nature of Kysely's transaction.
    const result = yield* Effect.tryPromise({
      try: () =>
        db.transaction().execute(async (trx) => {
          // --- TRANSACTION LOGIC BEGINS ---
          // Inside this async block, we can use `await`.

          // 1. Update the parent note's title and markdown content
          const parentNote = await trx
            .updateTable("note")
            .set({
              title: noteUpdate.title,
              content: noteUpdate.content,
              updated_at: new Date(),
            })
            .where("id", "=", validatedNoteId)
            .where("user_id", "=", validatedUserId)
            .returningAll()
            .executeTakeFirstOrThrow();

          // 2. Delete all existing child blocks for this note
          await trx
            .deleteFrom("block")
            .where("note_id", "=", validatedNoteId)
            .execute();

          // 3. Parse the new markdown content into new child blocks.
          // We must run the `parseMarkdownToBlocks` Effect here.
          const childBlocks = await Effect.runPromise(
            // Provide the required Crypto service to the parser effect
            Effect.provideService(
              Crypto,
              crypto,
            )(
              parseMarkdownToBlocks(
                noteUpdate.content,
                `${parentNote.id}.md`, // Use note ID for file path
                validatedUserId,
                validatedNoteId, // Pass the note ID
              ),
            ),
          );

          // 4. Insert the new child blocks if there are any
          if (childBlocks.length > 0) {
            await trx.insertInto("block").values(childBlocks).execute();
          }

          return parentNote;
          // --- TRANSACTION LOGIC ENDS ---
        }),
      catch: (cause) => new NoteDatabaseError({ cause }),
    });

    // Validate the final result from the transaction against the NoteSchema
    return yield* pipe(
      Schema.decodeUnknown(NoteSchema)(result),
      Effect.mapError((cause) => new NoteValidationError({ cause })),
      Effect.tap((updatedNote) =>
        Effect.forkDaemon(
          serverLog(
            "info",
            `[updateNote] Successfully updated note and reparsed blocks for ID: ${updatedNote.id}`,
            validatedUserId,
            "UpdateNote",
          ),
        ),
      ),
      Effect.catchAll((error) =>
        pipe(
          Effect.forkDaemon(
            serverLog(
              "error",
              `[updateNote] Failed to update note: ${error._tag}`,
              validatedUserId,
              "UpdateNote",
            ),
          ),
          Effect.andThen(() => Effect.fail(error)),
        ),
      ),
    );
  });
