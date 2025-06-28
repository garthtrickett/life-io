// FILE: features/notes/updateNote.ts
import { Effect, pipe } from "effect";
import { Db } from "../../db/DbTag";
import type { Updateable } from "kysely";
import type Note from "../../types/generated/Note";
import { serverLog } from "../../lib/server/logger.server";

export const updateNote = (
  noteId: string,
  userId: string,
  note: Updateable<Note>,
) =>
  Effect.gen(function* () {
    const db = yield* Db;

    yield* serverLog(
      "info",
      `Attempting to update note with ID: "${noteId}"`,
      userId,
      "UpdateNote",
    );

    const result = yield* pipe(
      Effect.tryPromise({
        try: () =>
          db
            .updateTable("note")
            .set({ ...note, updated_at: new Date() }) // Also update the timestamp
            .where("id", "=", noteId)
            .where("user_id", "=", userId) // Security check
            .returningAll()
            .executeTakeFirst(),
        catch: (error) => new Error(`Database Error: ${error}`),
      }),
      Effect.tap((updatedNote) =>
        serverLog(
          "info",
          `Successfully updated note with ID: ${updatedNote?.id}`,
          userId,
          "UpdateNote",
        ),
      ),
      Effect.catchAll((error) =>
        pipe(
          serverLog(
            "error",
            `Failed to update note: ${error.message}`,
            userId,
            "UpdateNote",
          ),
          Effect.andThen(() => Effect.fail(error)),
        ),
      ),
    );

    return result;
  });
