// FILE: migrations/2025062702_add_permissions_to_user.ts
import { Kysely, sql } from "kysely";

export async function up(db: Kysely<any>) {
  await db.schema
    .alterTable("user")
    .addColumn("permissions", sql`text[]`)
    .execute();
}

export async function down(db: Kysely<any>) {
  await db.schema.alterTable("user").dropColumn("permissions").execute();
}
