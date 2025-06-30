// features/notes/getNote.ts
import { Effect, pipe } from "effect";
import { Db } from "../../db/DbTag";
import { serverLog } from "../../lib/server/logger.server";
import { validateNoteId, validateUserId } from "../../lib/shared/domain";

export const getNote = (noteId: string, userId: string) =>
  Effect.gen(function* () {
    // --- Start: Validation ---
    const validatedNoteId = yield* validateNoteId(noteId);
    const validatedUserId = yield* validateUserId(userId);
    // --- End: Validation ---

    const db = yield* Db;

    yield* Effect.forkDaemon(
      serverLog(
        "info",
        `Attempting to fetch note with ID: "${validatedNoteId}"`, // Use validated ID
        validatedUserId, // Use validated ID
        "GetNote",
      ),
    );

    const result = yield* pipe(
      Effect.tryPromise({
        try: () =>
          db
            .selectFrom("note")
            .selectAll()
            .where("id", "=", validatedNoteId) // No 'as' cast needed
            .where("user_id", "=", validatedUserId) // No 'as' cast needed
            .executeTakeFirst(),
        catch: (error) => new Error(`Database Error: ${String(error)}`),
      }),
      Effect.tap((note) =>
        Effect.forkDaemon(
          serverLog(
            "info",
            note
              ? `Successfully fetched note: ${note.title}`
              : `Note with ID ${validatedNoteId} not found.`,
            validatedUserId,
            "GetNote",
          ),
        ),
      ),
      Effect.catchAll((error) =>
        pipe(
          Effect.forkDaemon(
            serverLog(
              "error",
              `Failed to fetch note: ${error.message}`,
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
