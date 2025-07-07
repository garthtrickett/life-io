// migrations/2025070501_create_poke_log.ts
import { Kysely } from "kysely";
import type { Database } from "../types";

export async function up(db: Kysely<Database>) {
  await db.schema
    .createTable("poke_log")
    .ifNotExists()
    .addColumn("id", "bigserial", (c) => c.primaryKey())
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(db.fn("now")),
    )
    .execute();
}

export async function down(db: Kysely<Database>) {
  await db.schema.dropTable("poke_log").ifExists().execute();
}
