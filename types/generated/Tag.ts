// FILE: types/generated/NoteTag.ts
// --- This file is correct as it has no default values ---
import type { ColumnType } from "kysely";

/** Represents the public.note_tag table */
export default interface NoteTag {
  note_id: ColumnType<string, string, string>;
  tag_id: ColumnType<string, string, string>;
}
