// features/notes/createNote.ts
import { Effect, pipe } from "effect";
import { Db } from "../../db/DbTag";
import type { NewNote } from "../../types/generated/public/Note";
import { serverLog } from "../../lib/server/logger.server";
import { validateUserId } from "../../lib/shared/domain";

export const createNote = (note: NewNote) =>
  Effect.gen(function* () {
    // --- Start: Validation ---
    // The user_id inside the note object must be validated.
    const validatedUserId = yield* validateUserId(note.user_id);
    // --- End: Validation ---

    const db = yield* Db;

    yield* Effect.forkDaemon(
      serverLog(
        "info",
        `Attempting to create note titled: "${note.title}"`,
        validatedUserId, // Use validated ID
        "CreateNote",
      ),
    );

    const result = yield* pipe(
      Effect.tryPromise({
        try: () =>
          db.insertInto("note").values(note).returningAll().executeTakeFirst(),
        catch: (error) => new Error(`Database Error: ${String(error)}`),
      }),
      Effect.tap((createdNote) =>
        Effect.forkDaemon(
          serverLog(
            "info",
            `Successfully created note with ID: ${createdNote?.id}`,
            validatedUserId, // Use validated ID
            "CreateNote",
          ),
        ),
      ),
      Effect.catchAll((error) =>
        pipe(
          Effect.forkDaemon(
            serverLog(
              "error",
              `Failed to create note: ${error.message}`,
              validatedUserId, // Use validated ID
              "CreateNote",
            ),
          ),
          Effect.andThen(() => Effect.fail(error)),
        ),
      ),
    );

    return result;
  });
