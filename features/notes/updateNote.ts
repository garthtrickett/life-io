// FILE: features/notes/updateNote.ts
import { Effect, pipe } from "effect";
import { Db } from "../../db/DbTag";
import type { NoteUpdate, Note } from "../../types/generated/public/Note";
import { serverLog } from "../../lib/server/logger.server";
import { validateNoteId, validateUserId } from "../../lib/shared/domain";
import {
  NoteDatabaseError,
  NoteNotFoundError,
  NoteValidationError,
} from "./Errors";
import { Schema } from "@effect/schema";
import { NoteSchema } from "../../lib/shared/schemas";
// --- FIX: Map validation errors and adjust function return type ---
export const updateNote = (
  noteId: string,
  userId: string,
  note: NoteUpdate,
): Effect.Effect<
  Note,
  NoteDatabaseError | NoteNotFoundError | NoteValidationError,
  Db
> =>
  Effect.gen(function* () {
    const validatedNoteId = yield* validateNoteId(noteId).pipe(
      Effect.mapError((cause) => new NoteValidationError({ cause })),
    );
    const validatedUserId = yield* validateUserId(userId).pipe(
      Effect.mapError((cause) => new NoteValidationError({ cause })),
    );
    const db = yield* Db;

    // *** LOGGING ADDED ***
    yield* Effect.forkDaemon(
      serverLog(
        "info",
        `[updateNote] Attempting to update note. ID: "${validatedNoteId}", UserID: "${validatedUserId}", Payload: ${JSON.stringify(note)}`,
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
        catch: (error) => new NoteDatabaseError({ cause: error }),
      }),
      Effect.tap((maybeNote) =>
        // *** LOGGING ADDED ***
        serverLog(
          "debug",
          `[updateNote] Database returned: ${JSON.stringify(maybeNote)}`,
          validatedUserId,
          "UpdateNote:DBResult",
        ),
      ),
      Effect.flatMap((maybeNote) =>
        Effect.if(maybeNote === undefined, {
          onTrue: () => Effect.fail(new NoteNotFoundError({ noteId, userId })),
          onFalse: () =>
            Schema.decodeUnknown(NoteSchema)(maybeNote!).pipe(
              Effect.mapError((cause) => new NoteValidationError({ cause })),
            ),
        }),
      ),
      Effect.tap((updatedNote) =>
        Effect.forkDaemon(
          serverLog(
            "info",
            `[updateNote] Successfully updated note with ID: ${updatedNote.id}`,
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
    return result;
  });
