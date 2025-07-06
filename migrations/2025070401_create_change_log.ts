// migrations/2025070401_create_change_log.ts
import { Kysely } from "kysely";
import type { Database } from "../types";

export async function up(db: Kysely<Database>) {
  await db.schema
    .createTable("change_log")
    .ifNotExists()
    // Use 'bigserial' for a 64-bit auto-incrementing integer. This is our new global version number.
    .addColumn("id", "bigserial", (c) => c.primaryKey())
    .addColumn("client_group_id", "text", (c) =>
      c.notNull().references("replicache_client_group.id").onDelete("cascade"),
    )
    .addColumn("client_id", "text", (c) =>
      c.notNull().references("replicache_client.id").onDelete("cascade"),
    )
    .addColumn("mutation_id", "integer", (c) => c.notNull())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("args", "jsonb", (c) => c.notNull())
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(db.fn("now")),
    )
    .execute();

  // It's good practice to add an index on the columns we'll be querying.
  await db.schema
    .createIndex("change_log_client_group_id_id_idx")
    .on("change_log")
    .columns(["client_group_id", "id"])
    .execute();
}

export async function down(db: Kysely<Database>) {
  await db.schema.dropTable("change_log").ifExists().execute();
}
