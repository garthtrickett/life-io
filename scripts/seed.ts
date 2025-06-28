// scripts/seed.ts
import { db } from "../db/kysely";
import { serverLog } from "../lib/server/logger.server";
import { Effect } from "effect";
import { perms } from "../lib/shared/permissions";
import type { UserId } from "../types/generated/public/User";
import { Argon2id } from "oslo/password"; // Import the password hashing utility

const TEST_USER_PASSWORD = "password123"; // Define a clear, known password for the test user

async function seed() {
  const argon2id = new Argon2id();
  const hashedPassword = await argon2id.hash(TEST_USER_PASSWORD); // Generate a valid hash

  const TEST_USER = {
    id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" as UserId,
    email: "test@example.com",
    password_hash: hashedPassword, // Use the real hash
    permissions: [perms.note.read, perms.note.write],
  };

  try {
    await Effect.runPromise(
      serverLog(
        "info",
        `Seeding database with test user... (Email: ${TEST_USER.email}, Password: ${TEST_USER_PASSWORD})`,
        undefined,
        "SeedScript",
      ),
    );

    const result = await db
      .insertInto("user")
      .values(TEST_USER)
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({
          email: TEST_USER.email,
          password_hash: TEST_USER.password_hash,
          permissions: TEST_USER.permissions,
        }),
      )
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
    await db.destroy();
  }
}

seed();
