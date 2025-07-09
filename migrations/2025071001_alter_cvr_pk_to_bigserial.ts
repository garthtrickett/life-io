// migrations/2025071001_alter_cvr_pk_to_bigserial.ts
import { Kysely } from "kysely";
import type { Database } from "../types";

export async function up(db: Kysely<Database>) {
  // Drop the existing table and recreate it with the correct PK type.
  // This is simpler and safer for a non-production table than altering the PK.
  await db.schema.dropTable("client_view_record").ifExists().execute();

  await db.schema
    .createTable("client_view_record")
    .ifNotExists()
    .addColumn("id", "bigserial", (c) => c.primaryKey()) // Use bigserial for a monotonic integer
    .addColumn("user_id", "uuid", (c) =>
      c.notNull().references("user.id").onDelete("cascade"),
    )
    .addColumn("data", "jsonb", (c) => c.notNull())
    .addColumn("created_at", "timestamp", (c) =>
      c.notNull().defaultTo(db.fn("now")),
    )
    .execute();

  // Recreate the index
  await db.schema
    .createIndex("cvr_user_id_created_at_idx")
    .on("client_view_record")
    .columns(["user_id", "created_at"])
    .execute();
}

export async function down(db: Kysely<Database>) {
  // To reverse, we'll restore the UUID-based version
  await db.schema.dropTable("client_view_record").ifExists().execute();
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
