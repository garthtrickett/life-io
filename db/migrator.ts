// File: ./db/migrator.ts
import { Effect, Exit, Cause } from "effect";
import { Kysely } from "kysely";
// --- REMOVED ---
// import { db } from "./kysely";
// --- ADDED ---
import { makeDbLive } from "./kysely"; // Import the effect that creates the DB
import { Database } from "../types";

import { serverLog } from "../lib/server/logger.server";
import { Migrator } from "kysely";
import { EmbeddedCentralMigrationProvider } from "../lib/server/migrations/EmbeddedCentralMigrationProvider";

// --- MODIFIED: The function now accepts the db instance ---
const runMigrations = (direction: "up" | "down", db: Kysely<Database>) =>
  Effect.gen(function* () {
    yield* serverLog(
      "info",
      `Running migrations via migrator.ts: ${direction}`,
      undefined,
      "EffectMigrator",
    );

    const migrator = new Migrator({
      db, // Use the passed-in instance
      provider: new EmbeddedCentralMigrationProvider(),
    });

    const { error, results } = yield* Effect.tryPromise({
      try: () =>
        direction === "up"
          ? migrator.migrateToLatest()
          : migrator.migrateDown(),
      catch: (e) => new Error(`Migration execution failed: ${String(e)}`),
    });

    for (const it of results ?? []) {
      yield* serverLog(
        it.status === "Success" ? "info" : "error",
        `Migration "${it.migrationName}" status: ${it.status}`,
        undefined,
        "EffectMigrator",
      );
    }

    if (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : JSON.stringify(error, null, 2);
      yield* serverLog(
        "error",
        `Migration failed: ${errorMessage}`,
        undefined,
        "EffectMigrator",
      );
      return yield* Effect.fail(error);
    }
  });

// --- MODIFIED: Execution logic now builds its own runtime ---
const getDirection = () => {
  const directionArg = Bun.argv[2];
  if (directionArg !== "up" && directionArg !== "down") {
    console.warn("No direction specified (or invalid). Defaulting to 'up'.");
    return "up";
  }
  return directionArg;
};

const direction = getDirection();

// Create a main program that first builds the DB connection, then runs migrations
const program = Effect.gen(function* () {
  // 1. Create the db instance from our live effect
  const db = yield* makeDbLive;

  // 2. Ensure the connection is destroyed after the main logic runs
  yield* Effect.ensuring(
    runMigrations(direction, db),
    Effect.promise(() => db.destroy()),
  );
});

void Effect.runPromiseExit(program).then((exit) => {
  if (Exit.isFailure(exit)) {
    console.error(`❌ Migration via migrator.ts failed ('${direction}'):`);
    console.error(Cause.pretty(exit.cause));
    process.exit(1);
  } else {
    console.info(
      `✅ Migrations via migrator.ts completed successfully ('${direction}').`,
    );
    process.exit(0);
  }
});
// --- REMOVED: db.destroy() is now handled within the main `program` effect ---
// .finally(() => {
//   void db.destroy();
// });
