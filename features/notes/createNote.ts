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
import { withCreateNoteLogging } from "./wrappers";
import { Crypto } from "../../lib/server/crypto";
import { parseMarkdownToBlocks } from "../../lib/server/parser";
import { NoteId } from "../../types/generated/public/Note";
const createNoteEffect = (
  note: NewNote,
): Effect.Effect<
  Note,
  NoteDatabaseError | NoteValidationError,
  Db | PokeService | Crypto
> =>
  Effect.gen(function* () {
    const validatedUserId = yield* validateUserId(note.user_id).pipe(
      Effect.mapError((cause) => new NoteValidationError({ cause })),
    );

    const db = yield* Db;
    const pokeService = yield* PokeService;
    const crypto = yield* Crypto;

    yield* Effect.forkDaemon(
      serverLog(
        "info",
        `Attempting to create note titled: "${note.title}"`,
        validatedUserId,
        "CreateNote:Attempt",
      ),
    );

    const dbRecord = yield* Effect.tryPromise({
      try: () =>
        db.transaction().execute(async (trx) => {
          const maybeInserted = await trx
            .insertInto("note")
            .values({ ...note, version: 1 })
            .onConflict((oc) => oc.column("id").doNothing())
            .returningAll()
            .executeTakeFirst();

          const record =
            maybeInserted ??
            (await trx
              .selectFrom("note")
              .selectAll()
              .where("id", "=", note.id as NoteId)
              .executeTakeFirst());
          if (!record) {
            // This indicates a serious issue if the row is missing after a conflict.
            throw new Error(
              `Failed to find note with ID ${note.id} after conflict.`,
            );
          }

          const childBlocks = await Effect.runPromise(
            Effect.provideService(
              Crypto,
              crypto,
            )(
              parseMarkdownToBlocks(
                record.content,
                `${record.id}.md`,
                validatedUserId,
                record.id,
              ),
            ),
          );
          if (childBlocks.length > 0) {
            await trx.insertInto("block").values(childBlocks).execute();
          }

          return record;
        }),
      catch: (cause) => new NoteDatabaseError({ cause }),
    });
    const createdNote = yield* Schema.decodeUnknown(NoteSchema)(dbRecord).pipe(
      Effect.mapError((cause) => new NoteValidationError({ cause })),
    );
    yield* pokeService
      .poke(createdNote.user_id)
      .pipe(Effect.mapError((cause) => new NoteDatabaseError({ cause })));
    return createdNote;
  });

export const createNote = (note: NewNote) =>
  pipe(createNoteEffect(note), withCreateNoteLogging(note.user_id, note.title));
