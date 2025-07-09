// FILE: migrations/2025070902_create_cvr_table.ts
import { Kysely } from "kysely";
import type { Database } from "../types";

export async function up(db: Kysely<Database>) {
  await db.schema
    .createTable("client_view_record")
    .ifNotExists()
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(db.fn("gen_random_uuid")),
    )
    .addColumn("user_id", "uuid", (c) =>
      c.notNull().references("user.id").onDelete("cascade"),
    )
    .addColumn("data", "jsonb", (c) => c.notNull())
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(db.fn("now")),
    )
    .execute();

  await db.schema
    .createIndex("cvr_user_id_created_at_idx")
    .on("client_view_record")
    .columns(["user_id", "created_at"])
    .execute();
}

export async function down(db: Kysely<Database>) {
  await db.schema.dropTable("client_view_record").ifExists().execute();
}
