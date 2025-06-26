import { Effect, Context, Layer, pipe, Exit, Cause } from "effect";
import { Kysely } from "kysely";
import type { Database } from "../types";
import { BunPgDialect } from "../lib/kysely-bun-dialect";
import { centralMigrationObjects } from "../lib/server/migrations/central-migrations-manifest";

// 1. Define a Context Tag for the Kysely instance
class Db extends Context.Tag("Db")<Db, Kysely<Database>>() {}

// 2. Create a Layer to manage the Kysely instance lifecycle
const DbLayer = Layer.scoped(
  Db,
  Effect.acquireRelease(
    Effect.sync(() => new Kysely<Database>({ dialect: new BunPgDialect() })),
    (db) => Effect.sync(() => db.destroy()),
  ),
);

// 3. Define the migration logic as a declarative Effect
const runAllMigrations = (direction: "up" | "down") =>
  Effect.gen(function* () {
    const db = yield* Db;

    const migrations = Object.entries(centralMigrationObjects)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, mig]) => ({ id, ...mig }));

    yield* Effect.log(`Running all migrations: ${direction}`);

    yield* Effect.forEach(
      migrations,
      (m) =>
        Effect.gen(function* () {
          yield* Effect.log(
            `${direction === "up" ? "▶" : "⏮️"}  Executing ${m.id}`,
          );

          // Select the correct migration function based on direction.
          const migrationFn = direction === "up" ? m.up : m.down;

          // UNHAPPY PATH FIRST: If there's no migration function for this direction, do nothing.
          if (!migrationFn) {
            return yield* Effect.void;
          }

          // HAPPY PATH: The migration function exists, so execute it.
          // This avoids the nested if/else if block.
          yield* Effect.tryPromise(() => migrationFn(db));
        }),
      { concurrency: 1 },
    );
  });

// 4. Define and execute the main program

const getDirection = () => {
  const directionArg = Bun.argv[2];
  if (directionArg !== "up" && directionArg !== "down") {
    console.warn("No direction specified (or invalid). Defaulting to 'up'.");
    return "up";
  }
  return directionArg;
};

const direction = getDirection();
const program = runAllMigrations(direction);

// Pipe the program into its provider (DbLayer) and then execute it.
pipe(program, Effect.provide(DbLayer), Effect.runPromiseExit).then((exit) => {
  // UNHAPPY PATH FIRST: Handle the failure case immediately.
  if (Exit.isFailure(exit)) {
    console.error(`❌ Migration failed ('${direction}'):`);
    console.error(Cause.pretty(exit.cause));
    process.exit(1);
  }

  // HAPPY PATH: This code now only runs on success.
  console.log(`✅ Migrations completed successfully ('${direction}').`);
  process.exit(0);
});
