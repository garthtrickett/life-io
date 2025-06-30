// features/notes/createNote.ts
import { Effect, pipe } from "effect";
import { Db } from "../../db/DbTag";
import type { NewNote } from "../../types/generated/public/Note";
import { serverLog } from "../../lib/server/logger.server";
import { validateUserId } from "../../lib/shared/domain";
import { NoteDatabaseError } from "./Errors"; // <-- Import specific error

export const createNote = (note: NewNote) =>
  Effect.gen(function* () {
    const validatedUserId = yield* validateUserId(note.user_id);
    const db = yield* Db;

    yield* Effect.forkDaemon(
      serverLog(
        "info",
        `Attempting to create note titled: "${note.title}"`,
        validatedUserId,
        "CreateNote",
      ),
    );

    const result = yield* pipe(
      Effect.tryPromise({
        try: () =>
          db.insertInto("note").values(note).returningAll().executeTakeFirst(),
        // --- REFACTORED: Catch and wrap in a specific error ---
        catch: (error) => new NoteDatabaseError({ cause: error }),
      }),
      Effect.tap((createdNote) =>
        Effect.forkDaemon(
          serverLog(
            "info",
            `Successfully created note with ID: ${createdNote?.id}`,
            validatedUserId,
            "CreateNote",
          ),
        ),
      ),
      Effect.catchAll((error) =>
        pipe(
          Effect.forkDaemon(
            serverLog(
              "error",
              // --- UPDATED: Log the specific error tag for better context ---
              `Failed to create note: ${error._tag}`,
              validatedUserId,
              "CreateNote",
            ),
          ),
          Effect.andThen(() => Effect.fail(error)),
        ),
      ),
    );

    return result;
  });
