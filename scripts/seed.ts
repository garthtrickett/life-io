// scripts/seed.ts
import { db } from "../db/kysely"; // Correctly import the shared db instance
import { serverLog } from "../lib/server/logger.server";
import { Effect } from "effect";

const TEST_USER = {
  id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  email: "test@example.com",
  password_hash: "supersecret-hash",
};

async function seed() {
  // The 'db' instance is now imported, not created locally.
  try {
    await Effect.runPromise(
      serverLog(
        "info",
        "Seeding database with test user...",
        undefined,
        "SeedScript",
      ),
    );

    const result = await db
      .insertInto("user")
      .values(TEST_USER)
      .onConflict((oc) => oc.column("id").doNothing())
      .returning("id")
      .executeTakeFirst();

    if (result) {
      await Effect.runPromise(
        serverLog(
          "info",
          `✅ User '${TEST_USER.email}' seeded successfully.`,
          undefined,
          "SeedScript",
        ),
      );
    } else {
      await Effect.runPromise(
        serverLog(
          "warn",
          `- User '${TEST_USER.email}' already exists. Skipping.`,
          undefined,
          "SeedScript",
        ),
      );
    }
  } catch (e) {
    await Effect.runPromise(
      serverLog("error", `Seeding failed: ${e}`, undefined, "SeedScript"),
    );
    process.exit(1);
  } finally {
    // We no longer need to destroy the connection here, as its lifecycle
    // is managed by the application's main process.
    await db.destroy();
  }
}

seed();
