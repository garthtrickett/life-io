// FILE: features/notes/getNote.ts
import { Effect, pipe } from "effect";
import { Db } from "../../db/DbTag";
import { serverLog } from "../../lib/server/logger.server";
import { validateNoteId, validateUserId } from "../../lib/shared/domain";
import {
  NoteDatabaseError,
  NoteNotFoundError,
  NoteValidationError,
} from "./Errors";
import { Schema } from "@effect/schema";
import { NoteSchema } from "../../lib/shared/schemas";
import type { Note } from "../../types/generated/public/Note";

// --- FIX: Map validation errors and adjust function return type ---
export const getNote = (
  noteId: string,
  userId: string,
): Effect.Effect<
  Note,
  NoteDatabaseError | NoteNotFoundError | NoteValidationError,
  Db
> =>
  Effect.gen(function* () {
    const validatedNoteId = yield* validateNoteId(noteId).pipe(
      Effect.mapError((cause) => new NoteValidationError({ cause })),
    );
    const validatedUserId = yield* validateUserId(userId).pipe(
      Effect.mapError((cause) => new NoteValidationError({ cause })),
    );
    const db = yield* Db;

    yield* Effect.forkDaemon(
      serverLog(
        "info",
        `Attempting to fetch note with ID: "${validatedNoteId}"`,
        validatedUserId,
        "GetNote",
      ),
    );

    const result = yield* pipe(
      Effect.tryPromise({
        try: () =>
          db
            .selectFrom("note")
            .selectAll()
            .where("id", "=", validatedNoteId)
            .where("user_id", "=", validatedUserId)
            .executeTakeFirst(),
        catch: (error) => new NoteDatabaseError({ cause: error }),
      }),
      Effect.flatMap((maybeNote) =>
        Effect.if(maybeNote === undefined, {
          onTrue: () => Effect.fail(new NoteNotFoundError({ noteId, userId })),
          onFalse: () =>
            Schema.decodeUnknown(NoteSchema)(maybeNote!).pipe(
              Effect.mapError((cause) => new NoteValidationError({ cause })),
            ),
        }),
      ),
      Effect.tap((note) =>
        Effect.forkDaemon(
          serverLog(
            "info",
            `Successfully fetched note: ${note.title}`,
            validatedUserId,
            "GetNote",
          ),
        ),
      ),
      Effect.catchAll((error) =>
        pipe(
          Effect.forkDaemon(
            serverLog(
              "error",
              `Failed to fetch note: ${error._tag}`,
              validatedUserId,
              "GetNote",
            ),
          ),
          Effect.andThen(() => Effect.fail(error)),
        ),
      ),
    );
    return result;
  });
