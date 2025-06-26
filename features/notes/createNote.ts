// FILE: features/notes/createNote.ts
// --- Fix: Correctly typed the `note` parameter using the `Note` interface ---

import { Effect } from "effect";
import { Db } from "../../db/DbTag";
import type { Insertable } from "kysely";
import type Note from "../../types/generated/Note"; // Import the generated Note interface

// Kysely's Insertable<T> utility type requires the table's interface type (Note),
// not the table name as a string ('note'). This change ensures the 'note'
// parameter has the correct type that Kysely's `values()` method expects.
export const createNote = (note: Insertable<Note>) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* Effect.promise(() =>
      db.insertInto("note").values(note).returningAll().executeTakeFirst(),
    );
  });
