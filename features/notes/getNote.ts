// features/notes/getNote.ts
import { Effect, Option, pipe } from "effect";
import { Db } from "../../db/DbTag";
import { serverLog } from "../../lib/server/logger.server";
import { validateNoteId, validateUserId } from "../../lib/shared/domain";
import { NoteDatabaseError, NoteNotFoundError } from "./Errors"; // <-- Import specific errors

export const getNote = (noteId: string, userId: string) =>
  Effect.gen(function* () {
    const validatedNoteId = yield* validateNoteId(noteId);
    const validatedUserId = yield* validateUserId(userId);
    const db = yield* Db;

    yield* Effect.forkDaemon(
      serverLog(
        "info",
        `Attempting to fetch note with ID: "${validatedNoteId}"`,
        validatedUserId,
        "GetNote",
      ),
    );

    const result = yield* pipe(
      Effect.tryPromise({
        try: () =>
          db
            .selectFrom("note")
            .selectAll()
            .where("id", "=", validatedNoteId)
            .where("user_id", "=", validatedUserId)
            .executeTakeFirst(),
        // --- REFACTORED: Catch and wrap in a specific error ---
        catch: (error) => new NoteDatabaseError({ cause: error }),
      }),
      // --- REFACTORED: Check if the note was found ---
      Effect.flatMap(Option.fromNullable),
      Effect.catchTag("NoSuchElementException", () =>
        Effect.fail(new NoteNotFoundError({ noteId, userId })),
      ),
      Effect.tap((note) =>
        Effect.forkDaemon(
          serverLog(
            "info",
            `Successfully fetched note: ${note.title}`,
            validatedUserId,
            "GetNote",
          ),
        ),
      ),
      // --- REFACTORED: Log the specific error ---
      Effect.catchAll((error) =>
        pipe(
          Effect.forkDaemon(
            serverLog(
              "error",
              `Failed to fetch note: ${error._tag}`,
              validatedUserId,
              "GetNote",
            ),
          ),
          Effect.andThen(() => Effect.fail(error)),
        ),
      ),
    );

    return result;
  });
