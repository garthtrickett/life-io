// FILE: migrations/2025062603_create_tag.ts
// --- Fix: Use ifNotExists() to make the migration idempotent ---
import type { Kysely } from "kysely";

import { Database } from "../types";

export async function up(db: Kysely<Database>) {
  await db.schema
    .createTable("tag")
    .ifNotExists() // This ensures the script doesn't fail if the table is already there
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(db.fn("gen_random_uuid")),
    )
    .addColumn("user_id", "uuid", (c) =>
      c.notNull().references("user.id").onDelete("cascade"),
    )
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(db.fn("now")),
    )
    .execute();
}

export async function down(db: Kysely<Database>) {
  await db.schema.dropTable("tag").ifExists().execute();
}
