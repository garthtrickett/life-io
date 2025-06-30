// FILE: features/notes/getNotes.ts
import { Effect, pipe } from "effect";
import { Db } from "../../db/DbTag";
import { serverLog } from "../../lib/server/logger.server";
import { validateUserId } from "../../lib/shared/domain";

export const getNotes = (userId: string) =>
  Effect.gen(function* () {
    // --- Start: Validation ---
    const validatedUserId = yield* validateUserId(userId);
    // --- End: Validation ---

    const db = yield* Db;

    yield* Effect.forkDaemon(
      serverLog(
        "info",
        `Attempting to fetch all notes for user ID: "${validatedUserId}"`,
        validatedUserId,
        "GetNotes",
      ),
    );

    const result = yield* pipe(
      Effect.tryPromise({
        try: () =>
          db
            .selectFrom("note")
            .selectAll()
            .where("user_id", "=", validatedUserId) // No 'as' cast needed
            .orderBy("updated_at", "desc")
            .execute(),
        catch: (error) => new Error(`Database Error: ${String(error)}`),
      }),
      Effect.tap((notes) =>
        Effect.forkDaemon(
          serverLog(
            "info",
            `Successfully fetched ${notes.length} notes.`,
            validatedUserId,
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
              validatedUserId,
              "GetNotes",
            ),
          ),
          Effect.andThen(() => Effect.fail(error)),
        ),
      ),
    );

    return result;
  });
