// FILE: features/notes/getNotes.ts
import { Effect, pipe } from "effect";
import { Db } from "../../db/DbTag";
import { serverLog } from "../../lib/server/logger.server";
import { UserId } from "../../types/generated/public/User";

export const getNotes = (userId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;

    yield* Effect.forkDaemon(
      serverLog(
        "info",
        `Attempting to fetch all notes for user ID: "${userId}"`,
        userId,
        "GetNotes",
      ),
    );

    const result = yield* pipe(
      Effect.tryPromise({
        try: () =>
          db
            .selectFrom("note")
            .selectAll()
            .where("user_id", "=", userId as UserId)
            .orderBy("updated_at", "desc")
            .execute(),
        catch: (error) => new Error(`Database Error: ${String(error)}`),
      }),
      Effect.tap((notes) =>
        Effect.forkDaemon(
          serverLog(
            "info",
            `Successfully fetched ${notes.length} notes.`,
            userId,
            "GetNotes",
          ),
        ),
      ),
      Effect.catchAll((error) =>
        pipe(
          Effect.forkDaemon(
            serverLog(
              "error",
              `Failed to fetch notes: ${error.message}`,
              userId,
              "GetNotes",
            ),
          ),
          Effect.andThen(() => Effect.fail(error)),
        ),
      ),
    );

    return result;
  });
