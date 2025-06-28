// FILE: types/generated/User.ts
// --- Final Fix: Mark columns with default values as optional for inserts ---
import type { ColumnType } from "kysely";

/** Represents the public.user table */
export default interface User {
  id: ColumnType<string, string | undefined, string>;
  email: ColumnType<string, string, string>;
  password_hash: ColumnType<string, string, string>;
  created_at: ColumnType<Date, Date | string | undefined, Date | string>;
  permissions: ColumnType<string[], string[] | undefined, string[]>;
}
