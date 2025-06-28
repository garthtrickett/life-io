// FILE: types.ts
// --- Fix: Use a more explicit re-export for the Database type ---
import type Database_ from "./types/generated/Database";

/**
 * The main Kysely database interface, combining all generated table types.
 *
 * We are re-exporting it explicitly here to ensure module resolution works correctly.
 */
export type { Database_ as Database };
