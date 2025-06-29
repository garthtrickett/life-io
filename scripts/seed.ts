// scripts/seed.ts
import { db } from "../db/kysely";
import { serverLog } from "../lib/server/logger.server";
import { perms } from "../lib/shared/permissions";
import type { UserId } from "../types/generated/public/User";
import { Argon2id } from "oslo/password";
import { Effect, Cause, Exit, pipe } from "effect";
import { DbLayer } from "../db/DbLayer";
import { Db } from "../db/DbTag";

const TEST_USER_PASSWORD = "password123";

/**
 * This is the core logic of our seeding script, defined as an Effect program.
 * It's a declarative description of the work to be done.
 */
const seedProgram = Effect.gen(function* () {
  yield* serverLog(
    "info",
    `Seeding database with test user... (Email: garthtrickett@gmail.com, Password: ${TEST_USER_PASSWORD})`,
    undefined,
    "SeedScript:Effect",
  );

  const argon2id = new Argon2id();
  const hashedPassword = yield* Effect.tryPromise({
    try: () => argon2id.hash(TEST_USER_PASSWORD),
    catch: (e) => new Error(`Failed to hash password: ${String(e)}`),
  });

  const TEST_USER = {
    id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" as UserId,
    email: "garthtrickett@gmail.com",
    password_hash: hashedPassword,
    permissions: [perms.note.read, perms.note.write],
  };

  const db = yield* Db;

  // Perform the database "upsert" operation within an effect.
  yield* pipe(
    Effect.tryPromise({
      try: () =>
        db
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
          .executeTakeFirst(),
      catch: (e) => new Error(`Database seeding failed: ${String(e)}`),
    }),
    Effect.tap(() =>
      // The onConflict clause ensures this is always an upsert.
      // We log a generic success message for both inserts and updates.
      serverLog(
        "info",
        `✅ User '${TEST_USER.email}' seeded/updated successfully.`,
        undefined,
        "SeedScript:Effect",
      ),
    ),
  );
});

// This is the full program, including dependency injection, error handling, and cleanup.
const program = pipe(
  seedProgram,
  Effect.catchAll((error) =>
    pipe(
      serverLog(
        "error",
        `Seeding failed: ${error.message}`,
        undefined,
        "SeedScript:Effect",
      ),
      // After logging, we fail the effect so the process exits with a non-zero code.
      Effect.andThen(Effect.fail(error)),
    ),
  ),
  Effect.provide(DbLayer),
  // `ensuring` is the Effect-TS equivalent of a `finally` block.
  // It runs whether the effect succeeds or fails, ensuring the DB connection is closed.
  Effect.ensuring(Effect.promise(() => db.destroy())),
);

// --- Execution Logic ---
// Run the program and handle the exit code, printing a clean error if it fails.
void Effect.runPromiseExit(program).then((exit) => {
  if (Exit.isSuccess(exit)) {
    process.exit(0);
  } else {
    // Cause.pretty provides a nicely formatted error log for failures.
    console.error("\n❌ Seeding script failed. Details below:\n");
    console.error(Cause.pretty(exit.cause));
    process.exit(1);
  }
});
