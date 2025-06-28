// FILE: migrations/2025062701_create_session.ts
import type { Kysely } from "kysely";

export async function up(db: Kysely<any>) {
  await db.schema
    .createTable("session")
    .ifNotExists()
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("user_id", "uuid", (c) =>
      c.notNull().references("user.id").onDelete("cascade"),
    )
    .addColumn("expires_at", "timestamp", (c) => c.notNull())
    .execute();
}

export async function down(db: Kysely<any>) {
  await db.schema.dropTable("session").ifExists().execute();
}
