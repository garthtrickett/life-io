// FILE: scripts/migrate.ts
import { Migrator, FileMigrationProvider } from "kysely";
import * as path from "node:path";
import { promises as fs } from "node:fs";
import { db } from "../db/kysely";
import { serverLog } from "../lib/server/logger.server";
import { Effect } from "effect";

async function migrate(direction: "up" | "down") {
  await Effect.runPromise(
    serverLog(
      "info",
      `Running migrations: ${direction}`,
      undefined,
      "MigrationScript",
    ),
  );

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(process.cwd(), "migrations"),
    }),
  });

  const handleResults = async (error?: unknown, results?: any[]) => {
    // Destructure each result object in the loop
    results?.forEach(({ status, migrationName }) => {
      Effect.runPromise(
        serverLog(
          status === "Success" ? "info" : "error",
          `Migration "${migrationName}" status: ${status}`,
          undefined,
          "MigrationScript",
        ),
      );
    });

    if (error) {
      await Effect.runPromise(
        serverLog(
          "error",
          `Migration failed: ${error}`,
          undefined,
          "MigrationScript",
        ),
      );
      process.exit(1);
    }

    await db.destroy();
  };

  if (direction === "down") {
    const { error, results } = await migrator.migrateDown();
    await handleResults(error, results);
  } else {
    const { error, results } = await migrator.migrateToLatest();
    await handleResults(error, results);
  }
}

const directionArg = process.argv[2];
if (directionArg !== "up" && directionArg !== "down") {
  Effect.runPromise(
    serverLog(
      "error",
      "Invalid argument. Use 'up' or 'down'.",
      undefined,
      "MigrationScript",
    ),
  ).then(() => process.exit(1));
} else {
  migrate(directionArg as "up" | "down").then(() => {
    Effect.runPromise(
      serverLog(
        "info",
        "✅ Migrations complete!",
        undefined,
        "MigrationScript",
      ),
    );
  });
}
