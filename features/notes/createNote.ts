// FILE: features/notes/createNote.ts
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
    const validatedUserId = yield* validateUserId(note.user_id).pipe(
      Effect.mapError((cause) => new NoteValidationError({ cause })),
    );
    const db = yield* Db;
    const pokeService = yield* PokeService;

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
        pipe(
          serverLog(
            "info",
            `Successfully created note with ID: ${createdNote.id}`,
            validatedUserId,
            "CreateNote",
          ),
          // After creating the note, we must update the state for Replicache
          Effect.andThen(
            serverLog(
              "info",
              `Incrementing CVR and poking clients for user ${validatedUserId}`,
              validatedUserId,
              "CreateNote:Replicache",
            ),
          ),
          Effect.andThen(
            Effect.tryPromise({
              try: () =>
                db
                  .updateTable("replicache_client_group")
                  .set((eb) => ({ cvr_version: eb("cvr_version", "+", 1) }))
                  .where("user_id", "=", validatedUserId)
                  .execute(),
              catch: (e) => new NoteDatabaseError({ cause: e }),
            }),
          ),
          Effect.andThen(pokeService.poke()),
        ),
      ),
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
