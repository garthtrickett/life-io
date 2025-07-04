// File: ./db/migrator.ts
import { Cause, Effect, Exit, Data } from "effect"; // Import Data
import type { Kysely } from "kysely";
import { makeDbLive } from "./kysely";
import type { Database } from "../types";
import { serverLog } from "../lib/server/logger.server";
import { Migrator } from "kysely";
import { CentralMigrationProvider } from "../lib/server/migrations/MigrationProviderTag";
import { CentralMigrationProviderLive } from "../lib/server/migrations/EmbeddedCentralMigrationProvider";

// --- NEW Tagged Error ---
class MigrationError extends Data.TaggedError("MigrationError")<{
  readonly cause: unknown;
}> {}

const runMigrations = (direction: "up" | "down", db: Kysely<Database>) =>
  Effect.gen(function* () {
    const providerService = yield* CentralMigrationProvider;

    yield* serverLog(
      "info",
      `Running migrations via migrator.ts: ${direction}`,
      undefined,
      "EffectMigrator",
    );

    const migrator = new Migrator({
      db,
      provider: {
        getMigrations: () => Effect.runPromise(providerService.getMigrations),
      },
    });

    const { error, results } = yield* Effect.tryPromise({
      try: () =>
        direction === "up"
          ? migrator.migrateToLatest()
          : migrator.migrateDown(),
      // Use the new tagged error
      catch: (cause) => new MigrationError({ cause }),
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

const getDirection = () => {
  const directionArg = Bun.argv[2];
  if (directionArg !== "up" && directionArg !== "down") {
    console.warn("No direction specified (or invalid). Defaulting to 'up'.");
    return "up";
  }
  return directionArg;
};

const direction = getDirection();
const program = Effect.gen(function* () {
  const db = yield* makeDbLive;
  yield* Effect.ensuring(
    runMigrations(direction, db),
    Effect.promise(() => db.destroy()),
  );
}).pipe(Effect.provide(CentralMigrationProviderLive));

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
