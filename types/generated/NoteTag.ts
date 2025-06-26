// FILE: types/generated/NoteTag.ts
// --- No changes needed, this file is correct ---
import type { ColumnType } from "kysely";

/** Represents the public.note_tag table */
export default interface NoteTag {
  note_id: ColumnType<string, string, string>;
  tag_id: ColumnType<string, string, string>;
}
