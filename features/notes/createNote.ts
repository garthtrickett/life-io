// ---------------------------------------------------------------------------
// Idempotent `createNote` mutation handler for Replicache
// ---------------------------------------------------------------------------
// Uses Effect.gen for clear, step-by-step business logic.
// Logging is handled by the withCreateNoteLogging wrapper.
// ---------------------------------------------------------------------------

import { Effect, pipe } from "effect";
import { Db } from "../../db/DbTag";
import type { NewNote, Note } from "../../types/generated/public/Note";
import { serverLog } from "../../lib/server/logger.server";
import { validateUserId } from "../../lib/shared/domain";
import { NoteDatabaseError, NoteValidationError } from "./Errors";
import { Schema } from "@effect/schema";
import { NoteSchema } from "../../lib/shared/schemas";
import { PokeService } from "../../lib/server/PokeService";
import { withCreateNoteLogging } from "./wrappers";

/**
 * Core business logic for creating a note idempotently.
 */
const createNoteEffect = (
  note: NewNote,
): Effect.Effect<
  Note,
  NoteDatabaseError | NoteValidationError,
  Db | PokeService
> =>
  Effect.gen(function* () {
    // 1. Validate inputs
    const validatedUserId = yield* validateUserId(note.user_id).pipe(
      Effect.mapError((cause) => new NoteValidationError({ cause })),
    );

    // 2. Get dependencies
    const db = yield* Db;
    const pokeService = yield* PokeService;

    // 3. Log the attempt (fire-and-forget)
    yield* Effect.forkDaemon(
      serverLog(
        "info",
        `Attempting to create note titled: "${note.title}"`,
        validatedUserId,
        "CreateNote:Attempt",
      ),
    );

    // 4. Try to insert (idempotent)
    const maybeInserted = yield* Effect.tryPromise({
      try: () =>
        db
          .insertInto("note")
          .values(note)
          .onConflict((oc) => oc.column("id").doNothing())
          .returningAll()
          .executeTakeFirst(),
      catch: (cause) => new NoteDatabaseError({ cause }),
    });

    // 5. If insert was skipped (conflict), fetch existing
    const dbRecord =
      maybeInserted ??
      (yield* Effect.gen(function* () {
        if (note.id === undefined) {
          return yield* Effect.fail(
            new NoteValidationError({
              cause: "note.id is required for idempotent creation",
            }),
          );
        }

        // Narrow to a guaranteed, non-nullable id for the query
        const noteId = note.id as NonNullable<NewNote["id"]>;

        const maybeExisting = yield* Effect.tryPromise({
          try: () =>
            db
              .selectFrom("note")
              .selectAll()
              .where("id", "=", noteId) // safe: noteId is definitely defined
              .executeTakeFirst(),
          catch: (cause) => new NoteDatabaseError({ cause }),
        });

        if (maybeExisting === undefined) {
          return yield* Effect.fail(
            new NoteDatabaseError({
              cause: "DB did not return created nor existing note record",
            }),
          );
        }
        return maybeExisting;
      }));

    // 6. Decode to ensure we have a valid Note
    const createdNote = yield* Schema.decodeUnknown(NoteSchema)(dbRecord).pipe(
      Effect.mapError((cause) => new NoteValidationError({ cause })),
    );

    // 7. Poke clients, mapping any raw Error into a NoteDatabaseError
    yield* pokeService
      .poke()
      .pipe(Effect.mapError((cause) => new NoteDatabaseError({ cause })));

    // 8. Return the final note
    return createdNote;
  });

/**
 * Public-facing feature.
 */
export const createNote = (note: NewNote) =>
  pipe(createNoteEffect(note), withCreateNoteLogging(note.user_id, note.title));
