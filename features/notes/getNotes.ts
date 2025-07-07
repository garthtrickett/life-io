import { Effect, pipe } from "effect";
import { Db } from "../../db/DbTag";
import { validateUserId } from "../../lib/shared/domain";
import { NoteDatabaseError, NoteValidationError } from "./Errors";
import { Schema } from "@effect/schema";
import { NotesSchema } from "../../lib/shared/schemas";
import type { Note } from "../../types/generated/public/Note";
import { withGetNotesLogging } from "./wrappers";

/**
 * Core business logic for fetching *all* notes for a user.
 * Returns a **readonly** array – the natural shape from Kysely and the schema.
 */
const getNotesEffect = (
  userId: string,
): Effect.Effect<
  readonly Note[],
  NoteDatabaseError | NoteValidationError,
  Db
> =>
  Effect.gen(function* () {
    // 1. Validate inputs
    const validatedUserId = yield* validateUserId(userId).pipe(
      Effect.mapError((cause) => new NoteValidationError({ cause })),
    );

    // 2. Get dependencies
    const db = yield* Db;

    // 3. Perform the main operation
    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .selectFrom("note")
          .selectAll()
          .where("user_id", "=", validatedUserId)
          .orderBy("updated_at", "desc")
          .execute(), // ← returns readonly Note[]
      catch: (cause) => new NoteDatabaseError({ cause }),
    });

    // 4. Decode and return the final result (still readonly)
    return yield* Schema.decodeUnknown(NotesSchema)(rows).pipe(
      Effect.mapError((cause) => new NoteValidationError({ cause })),
    );
  });

/**
 * Public-facing feature.
 * Composes the core logic with logging in a shallow pipe.
 */
export const getNotes = (userId: string) =>
  pipe(getNotesEffect(userId), withGetNotesLogging(userId));
