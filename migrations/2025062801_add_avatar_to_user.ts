// FILE: migrations/2025062801_add_avatar_to_user.ts
import { Kysely } from "kysely";
import { Database } from "../types";

export async function up(db: Kysely<Database>) {
  await db.schema
    .alterTable("user")
    .addColumn("avatar_url", "text") // Add a nullable text column
    .execute();
}

export async function down(db: Kysely<Database>) {
  await db.schema.alterTable("user").dropColumn("avatar_url").execute();
}
