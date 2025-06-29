// FILE: features/notes/updateNote.ts
import { Effect, pipe } from "effect";
import { Db } from "../../db/DbTag";
import type { NoteUpdate } from "../../types/generated/public/Note";
import { serverLog } from "../../lib/server/logger.server";
import { NoteId } from "../../types/generated/public/Note";
import { UserId } from "../../types/generated/public/User";

export const updateNote = (noteId: NoteId, userId: UserId, note: NoteUpdate) =>
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
        catch: (error) => new Error(`Database Error: ${String(error)}`),
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
