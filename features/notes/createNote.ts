// features/notes/createNote.ts
import { Effect, pipe } from "effect";
import { Db } from "../../db/DbTag";
import type { NewNote } from "../../types/generated/public/Note";
import { serverLog } from "../../lib/server/logger.server";

export const createNote = (note: NewNote) =>
  Effect.gen(function* () {
    const db = yield* Db;

    yield* Effect.forkDaemon(
      serverLog(
        "info",
        `Attempting to create note titled: "${note.title}"`,
        note.user_id as string,
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
            note.user_id as string,
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
              note.user_id as string,
              "CreateNote",
            ),
          ),
          Effect.andThen(() => Effect.fail(error)),
        ),
      ),
    );

    return result;
  });
