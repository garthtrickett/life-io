// migrations/2025070901_add_version_to_note.ts
import { Kysely } from "kysely";
import type { Database } from "../types";

export async function up(db: Kysely<Database>) {
  await db.schema
    .alterTable("note")
    .addColumn("version", "integer", (c) => c.notNull().defaultTo(1))
    .execute();
}

export async function down(db: Kysely<Database>) {
  await db.schema.alterTable("note").dropColumn("version").execute();
}
