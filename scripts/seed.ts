// scripts/seed.ts
// --- REMOVED ---
// import { db } from "../db/kysely";

import { serverLog } from "../lib/server/logger.server";
import { perms } from "../lib/shared/permissions";
import type { UserId } from "../types/generated/public/User";
import { Argon2id } from "oslo/password";
import { Effect, Cause, Exit, pipe } from "effect";
import { DbLayer } from "../db/DbLayer";
import { Db } from "../db/DbTag";

const TEST_USER_PASSWORD = "password123";
const seedProgram = Effect.gen(function* () {
  yield* Effect.forkDaemon(
    serverLog(
      "info",
      `Seeding database with test user... (Email: garthtrickett@gmail.com, Password: ${TEST_USER_PASSWORD})`,
      undefined,
      "SeedScript:Effect",
    ),
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
    email_verified: true,
  };

  const db = yield* Db;

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
              email_verified: TEST_USER.email_verified,
            }),
          )
          .returning("id")
          .executeTakeFirst(),
      catch: (e) => new Error(`Database seeding failed: ${String(e)}`),
    }),
    Effect.tap(() =>
      Effect.forkDaemon(
        serverLog(
          "info",
          `✅ User '${TEST_USER.email}' seeded/updated successfully.`,
          undefined,
          "SeedScript:Effect",
        ),
      ),
    ),
  );
});

const program = pipe(
  seedProgram,
  Effect.catchAll((error) =>
    pipe(
      Effect.forkDaemon(
        serverLog(
          "error",
          `Seeding failed: ${error.message}`,
          undefined,
          "SeedScript:Effect",
        ),
      ),
      Effect.andThen(Effect.fail(error)),
    ),
  ),
  Effect.provide(DbLayer),
  // --- REMOVED ---
  // The manual `db.destroy()` is no longer needed. The DbLayer provided
  // to the effect will manage the connection lifecycle automatically.
  // Effect.ensuring(Effect.promise(() => db.destroy())),
);

void Effect.runPromiseExit(program).then((exit) => {
  if (Exit.isSuccess(exit)) {
    process.exit(0);
  } else {
    console.error("\n❌ Seeding script failed. Details below:\n");
    console.error(Cause.pretty(exit.cause));
    process.exit(1);
  }
});
