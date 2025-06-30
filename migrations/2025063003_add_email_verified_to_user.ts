// migrations/2025063003_add_email_verified_to_user.ts
import { Kysely } from "kysely";
import { Database } from "../types";

export async function up(db: Kysely<Database>) {
  await db.schema
    .alterTable("user")
    .addColumn("email_verified", "boolean", (c) => c.notNull().defaultTo(false))
    .execute();
}

export async function down(db: Kysely<Database>) {
  await db.schema.alterTable("user").dropColumn("email_verified").execute();
}
