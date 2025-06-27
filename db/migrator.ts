// FILE: db/migrator.ts
import { Effect, Exit, Cause } from "effect";
import { db } from "./kysely"; // Use the centralized db instance
import { serverLog } from "../lib/server/logger.server";
import { Migrator, FileMigrationProvider } from "kysely"; // Kysely's standard migrator
import * as path from "node:path";
import { promises as fs } from "node:fs";

// This migrator uses Kysely's default file-based discovery,
// so it does not need the manual centralMigrationObjects manifest.
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
      provider: new FileMigrationProvider({
        fs,
        path,
        migrationFolder: path.join(process.cwd(), "migrations"),
      }),
    });

    const { error, results } = yield* Effect.tryPromise({
      try: () =>
        direction === "up"
          ? migrator.migrateToLatest()
          : migrator.migrateDown(),
      catch: (e) => new Error(`Migration execution failed: ${e}`),
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
      yield* serverLog(
        "error",
        `Migration failed: ${error}`,
        undefined,
        "EffectMigrator",
      );
      return yield* Effect.fail(error);
    }
  });

// --- Execution Logic ---

const getDirection = () => {
  const directionArg = Bun.argv[2];
  if (directionArg !== "up" && directionArg !== "down") {
    console.warn("No direction specified (or invalid). Defaulting to 'up'.");
    return "up";
  }
  return directionArg as "up" | "down";
};

const direction = getDirection();
const program = runMigrations(direction);

Effect.runPromiseExit(program)
  .then((exit) => {
    if (Exit.isFailure(exit)) {
      console.error(`❌ Migration via migrator.ts failed ('${direction}'):`);
      console.error(Cause.pretty(exit.cause));
      process.exit(1);
    } else {
      console.log(
        `✅ Migrations via migrator.ts completed successfully ('${direction}').`,
      );
      process.exit(0);
    }
  })
  .finally(() => {
    db.destroy();
  });
