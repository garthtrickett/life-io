// migrations/2025070203_add_replicache_tables.ts
import { Kysely } from "kysely";
import { Database } from "../types";

export async function up(db: Kysely<Database>) {
  // Manages sync versions for groups of clients
  await db.schema
    .createTable("replicache_client_group")
    .ifNotExists()
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("user_id", "uuid", (c) => c.notNull())
    .addColumn("cvr_version", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("updated_at", "timestamp", (c) =>
      c.notNull().defaultTo(db.fn("now")),
    )
    .execute();

  // Stores individual client state
  await db.schema
    .createTable("replicache_client")
    .ifNotExists()
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("client_group_id", "text", (c) =>
      c.notNull().references("replicache_client_group.id").onDelete("cascade"),
    )
    .addColumn("last_mutation_id", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("updated_at", "timestamp", (c) =>
      c.notNull().defaultTo(db.fn("now")),
    )
    .execute();
}

export async function down(db: Kysely<Database>) {
  await db.schema.dropTable("replicache_client").ifExists().execute();
  await db.schema.dropTable("replicache_client_group").ifExists().execute();
}
