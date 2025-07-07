// lib/client/replicache/updateNote.ts
import { Effect } from "effect";
import { Schema } from "@effect/schema";
import { formatErrorSync } from "@effect/schema/TreeFormatter";
import { type WriteTransaction, type ReadonlyJSONValue } from "replicache";
import { NoteSchema } from "../../shared/schemas";
import { clientLog } from "../logger.client";
import { runClientPromise } from "../runtime";
import { withMutatorLogging } from "./helpers";

export async function updateNote(
  tx: WriteTransaction,
  { id, title, content }: { id: string; title: string; content: string },
): Promise<void> {
  const updateNoteEffect = Effect.gen(function* () {
    yield* clientLog(
      "info",
      `Executing mutator: updateNote for id ${id}`,
      undefined,
      "Replicache:updateNote",
    );

    const key = `note/${id}`;
    const noteJSON = yield* Effect.promise(() => tx.get(key));

    if (noteJSON === undefined) {
      return yield* Effect.fail(
        new Error(`Note with id ${id} not found for update.`),
      );
    }

    const note = yield* Schema.decodeUnknown(NoteSchema)(noteJSON).pipe(
      Effect.mapError((e) => new Error(formatErrorSync(e))),
    );

    const updated = { ...note, title, content, updated_at: new Date() };

    const validated = yield* Schema.decodeUnknown(NoteSchema)(updated).pipe(
      Effect.mapError(
        (e) =>
          new Error(`Updated note validation failed: ${formatErrorSync(e)}`),
      ),
    );
    const updatedForJSON: ReadonlyJSONValue = {
      ...validated,
      created_at: validated.created_at.toISOString(),
      updated_at: validated.updated_at.toISOString(),
    };
    yield* Effect.promise(() => tx.set(key, updatedForJSON));
  });

  return runClientPromise(
    updateNoteEffect.pipe(withMutatorLogging("updateNote")),
  );
}
