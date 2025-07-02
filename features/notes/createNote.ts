// FILE: features/notes/createNote.ts
import { Effect, pipe } from "effect";
import { Db } from "../../db/DbTag";
import type { NewNote, Note } from "../../types/generated/public/Note";
import { serverLog } from "../../lib/server/logger.server";
import { validateUserId } from "../../lib/shared/domain";
import { NoteDatabaseError, NoteValidationError } from "./Errors";
import { Schema } from "@effect/schema";
import { NoteSchema } from "../../lib/shared/schemas";

// --- FIX: Map validation errors and adjust function return type ---
export const createNote = (
  note: NewNote,
): Effect.Effect<Note, NoteDatabaseError | NoteValidationError, Db> =>
  Effect.gen(function* () {
    const validatedUserId = yield* validateUserId(note.user_id).pipe(
      Effect.mapError((cause) => new NoteValidationError({ cause })),
    );
    const db = yield* Db;

    yield* Effect.forkDaemon(
      serverLog(
        "info",
        `Attempting to create note titled: "${note.title}"`,
        validatedUserId,
        "CreateNote",
      ),
    );

    const result = yield* pipe(
      Effect.tryPromise({
        try: () =>
          db.insertInto("note").values(note).returningAll().executeTakeFirst(),
        catch: (error) => new NoteDatabaseError({ cause: error }),
      }),
      Effect.flatMap((maybeNote) =>
        Effect.if(maybeNote === undefined, {
          onTrue: () =>
            Effect.fail(
              new NoteDatabaseError({
                cause: "DB did not return created note",
              }),
            ),
          onFalse: () =>
            Schema.decodeUnknown(NoteSchema)(maybeNote!).pipe(
              Effect.mapError((cause) => new NoteValidationError({ cause })),
            ),
        }),
      ),
      Effect.tap((createdNote) =>
        Effect.forkDaemon(
          serverLog(
            "info",
            `Successfully created note with ID: ${createdNote.id}`,
            validatedUserId,
            "CreateNote",
          ),
        ),
      ),
      Effect.catchAll((error) =>
        pipe(
          Effect.forkDaemon(
            serverLog(
              "error",
              `Failed to create note: ${error._tag}`,
              validatedUserId,
              "CreateNote",
            ),
          ),
          Effect.andThen(() => Effect.fail(error)),
        ),
      ),
    );
    return result;
  });
