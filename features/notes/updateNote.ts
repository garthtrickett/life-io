// FILE: features/notes/updateNote.ts

import { Effect, pipe } from "effect";
import { Db } from "../../db/DbTag";
import type { Note } from "../../types/generated/public/Note";
import { serverLog } from "../../lib/server/logger.server";
import { validateNoteId, validateUserId } from "../../lib/shared/domain";
import {
  NoteDatabaseError,
  NoteNotFoundError,
  NoteValidationError,
} from "./Errors";
import { Schema } from "@effect/schema";
import { NoteSchema } from "../../lib/shared/schemas";
import { parseMarkdownToBlocks } from "../../lib/server/parser";
import { Crypto } from "../../lib/server/crypto";
import { PokeService } from "../../lib/server/PokeService";
import { withUpdateNoteLogging } from "./wrappers";

interface NoteUpdatePayload {
  title: string;
  content: string;
}

const updateNoteEffect = (
  noteId: string,
  userId: string,
  noteUpdate: NoteUpdatePayload,
): Effect.Effect<
  Note,
  NoteDatabaseError | NoteNotFoundError | NoteValidationError,
  Db | Crypto | PokeService
> =>
  Effect.gen(function* () {
    const validatedNoteId = yield* validateNoteId(noteId).pipe(
      Effect.mapError((cause) => new NoteValidationError({ cause })),
    );
    const validatedUserId = yield* validateUserId(userId).pipe(
      Effect.mapError((cause) => new NoteValidationError({ cause })),
    );

    const db = yield* Db;
    const crypto = yield* Crypto;
    const pokeService = yield* PokeService;

    yield* Effect.forkDaemon(
      serverLog(
        "info",
        `[UpdateNote] Starting update for note ID: "${validatedNoteId}"`,
        validatedUserId,
        "UpdateNote:Attempt",
      ),
    );

    const result = yield* Effect.tryPromise({
      try: () =>
        db.transaction().execute(async (trx) => {
          const parentNote = await trx
            .updateTable("note")
            .set({
              title: noteUpdate.title,
              content: noteUpdate.content,
              updated_at: new Date(),
            })
            .where("id", "=", validatedNoteId)
            .where("user_id", "=", validatedUserId)
            .returningAll()
            .executeTakeFirst();

          if (!parentNote) {
            // Throw a specific error if the note wasn't found to update
            throw new NoteNotFoundError({
              noteId: validatedNoteId,
              userId: validatedUserId,
            });
          }

          await trx
            .deleteFrom("block")
            .where("note_id", "=", validatedNoteId)
            .execute();

          const childBlocks = await Effect.runPromise(
            Effect.provideService(
              Crypto,
              crypto,
            )(
              parseMarkdownToBlocks(
                noteUpdate.content,
                `${parentNote.id}.md`,
                validatedUserId,
                validatedNoteId,
              ),
            ),
          );

          if (childBlocks.length > 0) {
            await trx.insertInto("block").values(childBlocks).execute();
          }

          return parentNote;
        }),
      catch: (cause) => {
        if (cause instanceof NoteNotFoundError) {
          return cause;
        }
        return new NoteDatabaseError({ cause });
      },
    });

    const updatedNote = yield* Schema.decodeUnknown(NoteSchema)(result).pipe(
      Effect.mapError((cause) => new NoteValidationError({ cause })),
    );

    yield* pokeService
      .poke(updatedNote.user_id)
      .pipe(Effect.mapError((cause) => new NoteDatabaseError({ cause })));

    return updatedNote;
  });

export const updateNote = (
  noteId: string,
  userId: string,
  noteUpdate: NoteUpdatePayload,
) =>
  pipe(
    updateNoteEffect(noteId, userId, noteUpdate),
    withUpdateNoteLogging(noteId, userId),
  );
