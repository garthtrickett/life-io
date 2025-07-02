// migrations/2025070201_create_block.ts
import { Kysely, sql } from "kysely";
import { Database } from "../types";

export async function up(db: Kysely<Database>) {
  await db.schema
    .createTable("block")
    .ifNotExists()
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(db.fn("gen_random_uuid")),
    )
    .addColumn("type", "text", (c) => c.notNull())
    .addColumn("content", "text", (c) => c.notNull())
    .addColumn("fields", "jsonb", (c) =>
      c.defaultTo(sql`'{}'::jsonb`).notNull(),
    )
    .addColumn("tags", sql`text[]`, (c) =>
      c.defaultTo(sql`'{}'::text[]`).notNull(),
    )
    .addColumn("links", sql`text[]`, (c) =>
      c.defaultTo(sql`'{}'::text[]`).notNull(),
    )
    .addColumn("transclusions", sql`text[]`, (c) =>
      c.defaultTo(sql`'{}'::text[]`).notNull(),
    )
    .addColumn("file_path", "text", (c) => c.notNull())
    .addColumn("parent_id", "uuid", (c) =>
      c.references("block.id").onDelete("cascade"),
    )
    .addColumn("depth", "integer", (c) => c.notNull())
    .addColumn("order", "integer", (c) => c.notNull())
    .addColumn("version", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("user_id", "uuid", (c) =>
      c.notNull().references("user.id").onDelete("cascade"),
    )
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(db.fn("now")),
    )
    .addColumn("updated_at", "timestamp", (c) =>
      c.notNull().defaultTo(db.fn("now")),
    )
    .execute();
}

export async function down(db: Kysely<Database>) {
  await db.schema.dropTable("block").ifExists().execute();
}
