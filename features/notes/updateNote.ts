// FILE: features/notes/updateNote.ts
import { Effect, pipe, Option } from "effect";
import { Db } from "../../db/DbTag";
import type { NoteUpdate } from "../../types/generated/public/Note";
import { serverLog } from "../../lib/server/logger.server";
import { validateNoteId, validateUserId } from "../../lib/shared/domain";
import { NoteDatabaseError, NoteNotFoundError } from "./Errors"; // <-- Import specific errors

export const updateNote = (noteId: string, userId: string, note: NoteUpdate) =>
  Effect.gen(function* () {
    const validatedNoteId = yield* validateNoteId(noteId);
    const validatedUserId = yield* validateUserId(userId);
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
            .where("id", "=", validatedNoteId)
            .where("user_id", "=", validatedUserId)
            .returningAll()
            .executeTakeFirst(),
        // --- REFACTORED: Catch and wrap in a specific error ---
        catch: (error) => new NoteDatabaseError({ cause: error }),
      }),
      // --- REFACTORED: Check if the update returned a note ---
      Effect.flatMap(Option.fromNullable),
      Effect.catchTag("NoSuchElementException", () =>
        Effect.fail(new NoteNotFoundError({ noteId, userId })),
      ),
      Effect.tap((updatedNote) =>
        Effect.forkDaemon(
          serverLog(
            "info",
            `Successfully updated note with ID: ${updatedNote.id}`,
            validatedUserId,
            "UpdateNote",
          ),
        ),
      ),
      // --- REFACTORED: Log the specific error ---
      Effect.catchAll((error) =>
        pipe(
          Effect.forkDaemon(
            serverLog(
              "error",
              `Failed to update note: ${error._tag}`,
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
