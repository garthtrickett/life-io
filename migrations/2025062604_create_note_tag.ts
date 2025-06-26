// FILE: migrations/2025062604_create_note_tag.ts
// --- Fix: Use ifNotExists() to make the migration idempotent ---
import type { Kysely } from "kysely";

export async function up(db: Kysely<any>) {
  await db.schema
    .createTable("note_tag")
    .ifNotExists() // This ensures the script doesn't fail if the table is already there
    .addColumn("note_id", "uuid", (c) =>
      c.notNull().references("note.id").onDelete("cascade"),
    )
    .addColumn("tag_id", "uuid", (c) =>
      c.notNull().references("tag.id").onDelete("cascade"),
    )
    .addPrimaryKeyConstraint("note_tag_pkey", ["note_id", "tag_id"])
    .execute();
}

export async function down(db: Kysely<any>) {
  await db.schema.dropTable("note_tag").ifExists().execute();
}
