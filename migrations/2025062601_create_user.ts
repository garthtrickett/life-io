// FILE: migrations/2025062601_create_user.ts
// --- Fix: Use ifNotExists() to make the migration idempotent ---
import type { Kysely } from "kysely";
import { Database } from "../types";

export async function up(db: Kysely<Database>) {
  await db.schema
    .createTable("user")
    .ifNotExists() // This ensures the script doesn't fail if the table is already there
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(db.fn("gen_random_uuid")),
    )
    .addColumn("email", "text", (c) => c.notNull().unique())
    .addColumn("password_hash", "text", (c) => c.notNull())
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(db.fn("now")),
    )
    .execute();
}

export async function down(db: Kysely<Database>) {
  await db.schema.dropTable("user").ifExists().execute();
}
