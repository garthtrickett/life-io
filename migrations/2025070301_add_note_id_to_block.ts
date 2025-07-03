// migrations/2025070301_add_note_id_to_block.ts
import { Kysely } from "kysely";
import { Database } from "../types";

export async function up(db: Kysely<Database>) {
  await db.schema
    .alterTable("block")
    .addColumn("note_id", "uuid", (c) =>
      c.references("note.id").onDelete("cascade"),
    )
    .execute();
}

export async function down(db: Kysely<Database>) {
  await db.schema.alterTable("block").dropColumn("note_id").execute();
}
