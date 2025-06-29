// File: ./db/migrator.ts
import { Effect, Exit, Cause } from "effect";
import { db } from "./kysely";
import { serverLog } from "../lib/server/logger.server";
import { Migrator, FileMigrationProvider } from "kysely";
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
      // The type of `error` is `unknown` here, which `Effect.fail` can handle.
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
