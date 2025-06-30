// FILE: scripts/migrate.ts
import { Migrator, FileMigrationProvider, type MigrationResult } from "kysely";
import * as path from "node:path";
import { promises as fs } from "node:fs";
import { db } from "../db/kysely";
import { serverLog } from "../lib/server/logger.server";
// --- FIX: Import the renamed `runServerUnscoped` ---
import { runServerUnscoped } from "../lib/server/runtime";

async function migrate(direction: "up" | "down") {
  // --- FIX: Use the renamed `runServerUnscoped` ---
  runServerUnscoped(
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

  const handleResults = async (
    error?: unknown,
    results?: MigrationResult[],
  ) => {
    results?.forEach(({ status, migrationName }) => {
      // --- FIX: Use the renamed `runServerUnscoped` ---
      runServerUnscoped(
        serverLog(
          status === "Success" ? "info" : "error",
          `Migration "${migrationName}" status: ${status}`,

          undefined,
          "MigrationScript",
        ),
      );
    });

    if (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : JSON.stringify(error, null, 2); // --- FIX: Use the renamed `runServerUnscoped` ---
      runServerUnscoped(
        serverLog(
          "error",
          `Migration failed: ${errorMessage}`,

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
  runServerUnscoped(
    serverLog(
      "error",
      "Invalid argument. Use 'up' or 'down'.",

      undefined,
      "MigrationScript",
    ),
  );
  process.exit(1);
} else {
  void migrate(directionArg).then(() => {
    // --- FIX: Use the renamed `runServerUnscoped` ---
    runServerUnscoped(
      serverLog(
        "info",

        "✅ Migrations complete!",
        undefined,
        "MigrationScript",
      ),
    );
  });
}
