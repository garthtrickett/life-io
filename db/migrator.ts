// File: ./db/migrator.ts
import { Effect, Exit, Cause } from "effect";
import { db } from "./kysely";
import { serverLog } from "../lib/server/logger.server";
import { Migrator } from "kysely";
// --- MODIFICATION START ---
// Import the new embedded provider instead of the file-based one
import { EmbeddedCentralMigrationProvider } from "../lib/server/migrations/EmbeddedCentralMigrationProvider";
// --- MODIFICATION END ---

const runMigrations = (direction: "up" | "down") =>
  Effect.gen(function* () {
    yield* serverLog(
      "info",
      `Running migrations via migrator.ts: ${direction}`,
      undefined,
      "EffectMigrator",
    );

    const migrator = new Migrator({
      db,
      // --- MODIFICATION START ---
      // Use the new provider here
      provider: new EmbeddedCentralMigrationProvider(),
      // --- MODIFICATION END ---
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

// --- Execution Logic (No changes needed here) ---

const getDirection = () => {
  const directionArg = Bun.argv[2];
  if (directionArg !== "up" && directionArg !== "down") {
    console.warn("No direction specified (or invalid). Defaulting to 'up'.");
    return "up";
  }
  return directionArg;
};

const direction = getDirection();
const program = runMigrations(direction);

void Effect.runPromiseExit(program)
  .then((exit) => {
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
  })
  .finally(() => {
    void db.destroy();
  });
