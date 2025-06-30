// FILE: features/notes/getNotes.ts
import { Effect, pipe } from "effect";
import { Db } from "../../db/DbTag";
import { serverLog } from "../../lib/server/logger.server";
import { validateUserId } from "../../lib/shared/domain";
import { NoteDatabaseError } from "./Errors"; // <-- Import specific error

export const getNotes = (userId: string) =>
  Effect.gen(function* () {
    const validatedUserId = yield* validateUserId(userId);
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
            .where("user_id", "=", validatedUserId)
            .orderBy("updated_at", "desc")
            .execute(),
        // --- REFACTORED: Catch and wrap in a specific error ---
        catch: (error) => new NoteDatabaseError({ cause: error }),
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
              // --- UPDATED: Log the specific error tag for better context ---
              `Failed to fetch notes: ${error._tag}`,
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
