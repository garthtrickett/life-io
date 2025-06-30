// features/notes/getNote.ts
import { Effect, pipe } from "effect";
import { Db } from "../../db/DbTag";
import { serverLog } from "../../lib/server/logger.server";
import { NoteId } from "../../types/generated/public/Note";
import { UserId } from "../../types/generated/public/User";

export const getNote = (noteId: string, userId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;

    yield* Effect.forkDaemon(
      serverLog(
        "info",
        `Attempting to fetch note with ID: "${noteId}"`,
        userId,
        "GetNote",
      ),
    );

    const result = yield* pipe(
      Effect.tryPromise({
        try: () =>
          db
            .selectFrom("note")
            .selectAll()
            .where("id", "=", noteId as NoteId)
            .where("user_id", "=", userId as UserId) // Ensure user
            .executeTakeFirst(),
        catch: (error) => new Error(`Database Error: ${String(error)}`),
      }),
      Effect.tap((note) =>
        Effect.forkDaemon(
          serverLog(
            "info",
            note
              ? `Successfully fetched note: ${note.title}`
              : `Note with ID ${noteId} not found.`,
            userId,
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
              userId,
              "GetNote",
            ),
          ),
          Effect.andThen(() => Effect.fail(error)),
        ),
      ),
    );

    return result;
  });
