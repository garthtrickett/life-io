// FILE: types/generated/Note.ts
// --- Final Fix: Mark columns with default values as optional for inserts ---
import type { ColumnType } from "kysely";

/** Represents the public.note table */
export default interface Note {
  id: ColumnType<string, string | undefined, string>;
  user_id: ColumnType<string, string, string>;
  title: ColumnType<string, string, string>;
  content: ColumnType<string, string, string>;
  created_at: ColumnType<Date, Date | string | undefined, Date | string>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}
