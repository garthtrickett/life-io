// scripts/seed.ts
import { Kysely } from "kysely";
import { BunPgDialect } from "../lib/kysely-bun-dialect";
import type { Database } from "../types";

// Hardcoded details for our test user
const TEST_USER = {
  id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", // A fixed UUID
  email: "test@example.com",
  password_hash: "supersecret-hash",
};

async function seed() {
  const db = new Kysely<Database>({
    dialect: new BunPgDialect(),
  });

  try {
    console.log("Seeding database with test user...");

    const result = await db
      .insertInto("user")
      .values(TEST_USER)
      .onConflict((oc) => oc.column("id").doNothing())
      .returning("id")
      .executeTakeFirst();

    if (result) {
      console.log(`✅ User '${TEST_USER.email}' seeded successfully.`);
    } else {
      console.log(`- User '${TEST_USER.email}' already exists. Skipping.`);
    }
  } finally {
    await db.destroy();
  }
}

seed().catch((e) => {
  console.error("Seeding failed:", e);
  process.exit(1);
});
