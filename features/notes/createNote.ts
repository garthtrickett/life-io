// FILE: features/notes/createNote.ts
// ---------------------------------------------------------------------------
// Idempotent `createNote` mutation handler for Replicache
// ---------------------------------------------------------------------------
// Fix:  note.id is optional in `NewNote`, but the SELECT that fetches the
// existing row requires a non‑null value.
// We now assert it is defined via
// `note.id!` *and* add a runtime guard that throws a validation error if it is
// missing.
// This eliminates the TypeScript "undefined not assignable" compile
// error while still protecting runtime correctness.
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

export const createNote = (
  note: NewNote,
): Effect.Effect<
  Note,
  NoteDatabaseError | NoteValidationError,
  Db | PokeService
> =>
  Effect.gen(function* () {
    // -----------------------------------------------------------------------
    // Validate user_id up‑front so we don’t touch the DB on obviously bad input
    // -----------------------------------------------------------------------
    const validatedUserId = yield* validateUserId(note.user_id).pipe(
      Effect.mapError((cause) => new NoteValidationError({ cause })),
    );

    const db = yield* Db;
    const pokeService = yield* PokeService;

    // Log intent asynchronously (don’t block main effect chain)
    yield* Effect.forkDaemon(
      serverLog(
        "info",
        `Attempting to create note titled: "${note.title}"`,
        validatedUserId,
        "CreateNote",
      ),
    );

    const result = yield* pipe(
      // -------------------------------------------------------------------
      // 1. Try an idempotent INSERT … ON CONFLICT DO NOTHING
      // -------------------------------------------------------------------
      Effect.tryPromise({
        try: () =>
          db
            .insertInto("note")
            .values(note)
            .onConflict((oc) => oc.column("id").doNothing())
            .returningAll()
            .executeTakeFirst(),
        catch: (error) => new NoteDatabaseError({ cause: error }),
      }),

      // -------------------------------------------------------------------
      // 2. If nothing was inserted (duplicate key), fetch the existing row.
      //    Guard against missing `note.id`.
      // -------------------------------------------------------------------
      Effect.flatMap((maybeInserted) =>
        Effect.if(maybeInserted === undefined, {
          onTrue: () =>
            Effect.if(note.id === undefined, {
              onTrue: () =>
                Effect.fail(
                  new NoteValidationError({
                    cause: "note.id is required to resolve ON CONFLICT path",
                  }),
                ),
              onFalse: () =>
                Effect.tryPromise({
                  try: () =>
                    db
                      .selectFrom("note")
                      .selectAll()
                      .where("id", "=", note.id!) // non‑null assertion
                      .executeTakeFirst(),
                  catch: (error) => new NoteDatabaseError({ cause: error }),
                }).pipe(
                  Effect.flatMap((maybeExisting) =>
                    Effect.if(maybeExisting === undefined, {
                      onTrue: () =>
                        Effect.fail(
                          new NoteDatabaseError({
                            cause:
                              "DB did not return created nor existing note record",
                          }),
                        ),
                      onFalse: () =>
                        Schema.decodeUnknown(NoteSchema)(maybeExisting!).pipe(
                          Effect.mapError(
                            (cause) => new NoteValidationError({ cause }),
                          ),
                        ),
                    }),
                  ),
                ),
            }),
          onFalse: () =>
            Schema.decodeUnknown(NoteSchema)(maybeInserted!).pipe(
              Effect.mapError((cause) => new NoteValidationError({ cause })),
            ),
        }),
      ),

      // -------------------------------------------------------------------
      // 3. Side‑effects: log success and poke clients
      // -------------------------------------------------------------------
      Effect.tap((createdNote) =>
        pipe(
          serverLog(
            "info",
            `Successfully created note with ID: ${createdNote.id}`,
            validatedUserId,
            "CreateNote",
          ),
          // MODIFICATION: The CVR version bump has been removed.
          // Poking clients is now the primary responsibility, which tells them
          // to pull from the new append-only log.
          Effect.andThen(
            serverLog(
              "info",
              `Poking clients for user ${validatedUserId}`,
              validatedUserId,
              "CreateNote:Replicache",
            ),
          ),
          Effect.andThen(pokeService.poke()),
        ),
      ),

      // -------------------------------------------------------------------
      // 4. Ensure we log *every* error before letting it propagate
      // -------------------------------------------------------------------
      Effect.catchAll((error) =>
        pipe(
          serverLog(
            "error",
            `Failed to create note: ${error._tag}`,
            validatedUserId,
            "CreateNote",
          ),
          Effect.andThen(() => Effect.fail(error)),
        ),
      ),
    );
    return result;
  });
