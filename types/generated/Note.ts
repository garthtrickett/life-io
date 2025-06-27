// FILE: types/generated/Note.ts
// --- Final Fix: Mark columns with default values as optional for inserts ---
import type { ColumnType } from "kysely";
import type { Selectable } from "kysely";

/** Represents the public.note table */
export default interface Note {
  id: ColumnType<string, string | undefined, string>;
  user_id: ColumnType<string, string, string>;
  title: ColumnType<string, string, string>;
  content: ColumnType<string, string, string>;
  // FIX: The select type (first argument) is now Date | string to account for JSON serialization
  created_at: ColumnType<
    Date | string,
    Date | string | undefined,
    Date | string
  >;
  updated_at: ColumnType<
    Date | string,
    Date | string | undefined,
    Date | string
  >;
}

export type NoteDto = Selectable<Note>;
