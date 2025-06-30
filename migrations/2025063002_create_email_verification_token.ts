// migrations/2025063002_create_email_verification_token.ts
import type { Kysely } from "kysely";
import { Database } from "../types";

export async function up(db: Kysely<Database>) {
  await db.schema
    .createTable("email_verification_token")
    .ifNotExists()
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("user_id", "uuid", (c) =>
      c.notNull().references("user.id").onDelete("cascade"),
    )
    .addColumn("email", "text", (c) => c.notNull())
    .addColumn("expires_at", "timestamp", (c) => c.notNull())
    .execute();
}

export async function down(db: Kysely<Database>) {
  await db.schema.dropTable("email_verification_token").ifExists().execute();
}
