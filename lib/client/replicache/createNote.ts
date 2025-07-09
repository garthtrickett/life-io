// FILE: lib/client/replicache/createNote.ts
import { Effect } from "effect";
import { Schema } from "@effect/schema";
import { formatErrorSync } from "@effect/schema/TreeFormatter";
import { type WriteTransaction, type ReadonlyJSONValue } from "replicache";
import type { NewNote } from "../../../types/generated/public/Note";
import { NoteSchema } from "../../shared/schemas";
import { clientLog } from "../logger.client";
import { runClientPromise } from "../runtime";
import { withMutatorLogging } from "./helpers";

export async function createNote(
  tx: WriteTransaction,
  args: NewNote,
): Promise<void> {
  const createNoteEffect = Effect.gen(function* () {
    yield* clientLog(
      "info",
      `Executing mutator: createNote for id ${args.id}`,
      args.user_id,
      "Replicache:createNote",
    );
    const key = `note/${args.id}`;
    const now = new Date();

    const note = yield* Schema.decodeUnknown(NoteSchema)({
      ...args,
      created_at: now,
      updated_at: now,
      version: 1, // Add version: 1 for the new note
    }).pipe(
      Effect.mapError(
        (e) => new Error(`Note validation failed: ${formatErrorSync(e)}`),
      ),
    );
    const noteForJSON: ReadonlyJSONValue = {
      ...note,
      created_at: note.created_at.toISOString(),
      updated_at: note.updated_at.toISOString(),
    };
    yield* Effect.promise(() => tx.set(key, noteForJSON));
  });
  return runClientPromise(
    createNoteEffect.pipe(withMutatorLogging("createNote")),
  );
}
