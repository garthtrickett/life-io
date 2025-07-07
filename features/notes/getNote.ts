// FILE: features/notes/getNote.ts
import { Effect, pipe } from "effect";
import { Db } from "../../db/DbTag";
import { validateNoteId, validateUserId } from "../../lib/shared/domain";
import {
  NoteDatabaseError,
  NoteNotFoundError,
  NoteValidationError,
} from "./Errors";
import { Schema } from "@effect/schema";
import { NoteSchema } from "../../lib/shared/schemas";
import type { Note } from "../../types/generated/public/Note";
import { withGetNoteLogging } from "./wrappers"; // Import the new wrapper

/**
 * The core business logic for fetching a note.
 * This "story" is now expressed clearly inside Effect.gen, free of cross-cutting concerns.
 */
const getNoteEffect = (
  noteId: string,
  userId: string,
): Effect.Effect<
  Note,
  NoteDatabaseError | NoteNotFoundError | NoteValidationError,
  Db
> =>
  Effect.gen(function* () {
    // 1. Validate inputs
    const validatedNoteId = yield* validateNoteId(noteId).pipe(
      Effect.mapError((cause) => new NoteValidationError({ cause })),
    );
    const validatedUserId = yield* validateUserId(userId).pipe(
      Effect.mapError((cause) => new NoteValidationError({ cause })),
    );

    // 2. Get dependencies
    const db = yield* Db;

    // 3. Perform the main operation
    const maybeNote = yield* Effect.tryPromise({
      try: () =>
        db
          .selectFrom("note")
          .selectAll()
          .where("id", "=", validatedNoteId)
          .where("user_id", "=", validatedUserId)
          .executeTakeFirst(),
      catch: (cause) => new NoteDatabaseError({ cause }),
    });

    // 4. Handle early exit (Not Found)
    if (maybeNote === undefined) {
      yield* Effect.fail(new NoteNotFoundError({ noteId, userId }));
    }

    // 5. Decode and return the final result
    return yield* Schema.decodeUnknown(NoteSchema)(maybeNote).pipe(
      Effect.mapError((cause) => new NoteValidationError({ cause })),
    );
  });

/**
 * The public-facing feature.
 * It composes the core logic with the logging wrapper in a shallow pipe.
 */
export const getNote = (noteId: string, userId: string) =>
  pipe(
    getNoteEffect(noteId, userId),
    withGetNoteLogging(noteId, userId), // Apply logging as a clean, final step
  );
