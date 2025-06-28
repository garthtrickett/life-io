// FILE: features/notes/getNote.ts
import { Effect, pipe } from "effect";
import { Db } from "../../db/DbTag";
import { serverLog } from "../../lib/server/logger.server";

export const getNote = (noteId: string, userId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;

    yield* serverLog(
      "info",
      `Attempting to fetch note with ID: "${noteId}"`,
      userId,
      "GetNote",
    );

    const result = yield* pipe(
      Effect.tryPromise({
        try: () =>
          db
            .selectFrom("note")
            .selectAll()
            .where("id", "=", noteId)
            .where("user_id", "=", userId) // Ensure user owns the note
            .executeTakeFirst(),
        catch: (error) => new Error(`Database Error: ${error}`),
      }),
      Effect.tap((note) =>
        serverLog(
          "info",
          note
            ? `Successfully fetched note: ${note.title}`
            : `Note with ID ${noteId} not found.`,
          userId,
          "GetNote",
        ),
      ),
      Effect.catchAll((error) =>
        pipe(
          serverLog(
            "error",
            `Failed to fetch note: ${error.message}`,
            userId,
            "GetNote",
          ),
          Effect.andThen(() => Effect.fail(error)),
        ),
      ),
    );

    return result;
  });
