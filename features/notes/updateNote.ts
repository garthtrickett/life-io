// FILE: features/notes/updateNote.ts
import { Effect, pipe } from "effect";
import { Db } from "../../db/DbTag";
import type { NoteUpdate } from "../../types/generated/public/Note";
import { serverLog } from "../../lib/server/logger.server";
import { validateNoteId, validateUserId } from "../../lib/shared/domain";

export const updateNote = (noteId: string, userId: string, note: NoteUpdate) =>
  Effect.gen(function* () {
    // --- Start: Validation ---
    const validatedNoteId = yield* validateNoteId(noteId);
    const validatedUserId = yield* validateUserId(userId);
    // --- End: Validation ---

    const db = yield* Db;

    yield* Effect.forkDaemon(
      serverLog(
        "info",
        `Attempting to update note with ID: "${validatedNoteId}"`,
        validatedUserId,
        "UpdateNote",
      ),
    );

    const result = yield* pipe(
      Effect.tryPromise({
        try: () =>
          db
            .updateTable("note")
            .set({ ...note, updated_at: new Date() })
            .where("id", "=", validatedNoteId) // No 'as' cast needed
            .where("user_id", "=", validatedUserId) // No 'as' cast needed
            .returningAll()
            .executeTakeFirst(),
        catch: (error) => new Error(`Database Error: ${String(error)}`),
      }),
      Effect.tap((updatedNote) =>
        Effect.forkDaemon(
          serverLog(
            "info",
            `Successfully updated note with ID: ${updatedNote?.id}`,
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
              `Failed to update note: ${error.message}`,
              validatedUserId,
              "UpdateNote",
            ),
          ),
          Effect.andThen(() => Effect.fail(error)),
        ),
      ),
    );

    return result;
  });
