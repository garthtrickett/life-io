// FILE: features/notes/createNote.ts
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
import { Crypto } from "../../lib/server/crypto"; // ⬅️ NEW
import { parseMarkdownToBlocks } from "../../lib/server/parser"; // ⬅️ NEW
import { NoteId } from "../../types/generated/public/Note";

/**
 * Core business logic for creating a note idempotently.
 */
const createNoteEffect = (
  note: NewNote,
): Effect.Effect<
  Note,
  NoteDatabaseError | NoteValidationError,
  Db | PokeService | Crypto // ⬅️ MODIFIED
> =>
  Effect.gen(function* () {
    // 1. Validate inputs
    const validatedUserId = yield* validateUserId(note.user_id).pipe(
      Effect.mapError((cause) => new NoteValidationError({ cause })),
    );

    // 2. Get dependencies
    const db = yield* Db;
    const pokeService = yield* PokeService;
    const crypto = yield* Crypto; // ⬅️ NEW

    // 3. Log the attempt (fire-and-forget)
    yield* Effect.forkDaemon(
      serverLog(
        "info",
        `Attempting to create note titled: "${note.title}"`,
        validatedUserId,
        "CreateNote:Attempt",
      ),
    );

    // 4. Perform main operation in a transaction
    const dbRecord = yield* Effect.tryPromise({
      try: () =>
        db.transaction().execute(async (trx) => {
          const maybeInserted = await trx
            .insertInto("note")
            .values(note)
            .onConflict((oc) => oc.column("id").doNothing())
            .returningAll()
            .executeTakeFirst();

          const record =
            maybeInserted ??
            (await trx
              .selectFrom("note")
              .selectAll()
              .where("id", "=", note.id as NoteId)
              .executeTakeFirstOrThrow());

          // --- BLOCK PARSING LOGIC ---
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
          // --- END BLOCK PARSING ---

          return record;
        }),
      catch: (cause) => new NoteDatabaseError({ cause }),
    });

    // 5. Decode to ensure we have a valid Note
    const createdNote = yield* Schema.decodeUnknown(NoteSchema)(dbRecord).pipe(
      Effect.mapError((cause) => new NoteValidationError({ cause })),
    );
    // 6. Poke clients
    yield* pokeService
      .poke()
      .pipe(Effect.mapError((cause) => new NoteDatabaseError({ cause })));
    // 7. Return the final note
    return createdNote;
  });

/**
 * Public-facing feature.
 */
export const createNote = (note: NewNote) =>
  pipe(createNoteEffect(note), withCreateNoteLogging(note.user_id, note.title));
