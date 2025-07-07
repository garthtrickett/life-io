// FILE: features/notes/updateNote.ts
// ---------------------------------------------------------------------------

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
import { PokeService } from "../../lib/server/PokeService"; // ⬅️ NEW
import { withUpdateNoteLogging } from "./wrappers";

interface NoteUpdatePayload {
  title: string;
  content: string; // raw markdown
}

/**
 * Core business logic for updating a note and its blocks.
 */
const updateNoteEffect = (
  noteId: string,
  userId: string,
  noteUpdate: NoteUpdatePayload,
): Effect.Effect<
  Note,
  NoteDatabaseError | NoteNotFoundError | NoteValidationError,
  Db | Crypto | PokeService // ⬅️ NEW
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
    const crypto = yield* Crypto;
    const pokeService = yield* PokeService; // ⬅️ NEW

    // 3. Log intent (fire-and-forget)
    yield* Effect.forkDaemon(
      serverLog(
        "info",
        `[UpdateNote] Starting update for note ID: "${validatedNoteId}"`,
        validatedUserId,
        "UpdateNote:Attempt",
      ),
    );

    // 4. Perform the main operation inside a transaction
    const result = yield* Effect.tryPromise({
      try: () =>
        db.transaction().execute(async (trx) => {
          // --- TRANSACTION LOGIC BEGINS ---
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
            .executeTakeFirstOrThrow();

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
          // --- TRANSACTION LOGIC ENDS ---
        }),
      catch: (cause) => new NoteDatabaseError({ cause }),
    });

    // 5. Decode against the schema
    const updatedNote = yield* Schema.decodeUnknown(NoteSchema)(result).pipe(
      Effect.mapError((cause) => new NoteValidationError({ cause })),
    );

    // 6. Poke clients so they pull fresh data              // ⬅️ NEW
    yield* pokeService
      .poke()
      .pipe(Effect.mapError((cause) => new NoteDatabaseError({ cause })));

    // 7. Return the updated note
    return updatedNote;
  });

/**
 * Public-facing feature.
 */
export const updateNote = (
  noteId: string,
  userId: string,
  noteUpdate: NoteUpdatePayload,
) =>
  pipe(
    updateNoteEffect(noteId, userId, noteUpdate),
    withUpdateNoteLogging(noteId, userId),
  );
