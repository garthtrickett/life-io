// FILE: ./scripts/seed.ts
// scripts/seed.ts
import { serverLog } from "../lib/server/logger.server";
import { perms } from "../lib/shared/permissions";
import type { UserId } from "../types/generated/public/User";
import { Argon2id } from "oslo/password";
import { Effect, Cause, Exit, pipe } from "effect";
import { DbLayer } from "../db/DbLayer";
import { Db } from "../db/DbTag";
import { toError } from "../lib/shared/toError";

const TEST_USER_PASSWORD = "password123";
const seedProgram = Effect.gen(function* () {
  yield* Effect.forkDaemon(
    serverLog(
      "info",
      { email: "garthtrickett@gmail.com", password: TEST_USER_PASSWORD },
      "Seeding database with test user...",
      "SeedScript:Effect",
    ),
  );

  const argon2id = new Argon2id();
  const hashedPassword = yield* Effect.tryPromise({
    try: () => argon2id.hash(TEST_USER_PASSWORD),
    catch: (e) => toError(e),
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
      catch: (e) => toError(e),
    }),
    Effect.tap(() =>
      Effect.forkDaemon(
        serverLog(
          "info",
          { email: TEST_USER.email },
          "✅ User seeded/updated successfully.",
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
          { error },
          `Seeding failed: ${error.message}`,
          "SeedScript:Effect",
        ),
      ),
      Effect.andThen(Effect.fail(error)),
    ),
  ),
  Effect.provide(DbLayer),
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
