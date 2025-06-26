// FILE: scripts/migrate.ts
import { Migrator, FileMigrationProvider } from "kysely";
import * as path from "node:path";
import { promises as fs } from "node:fs";
import { db } from "../db/kysely"; // Import our new central db instance

async function migrate(direction: "up" | "down") {
  console.log(`Running migrations: ${direction}`);

  const migrator = new Migrator({
    db, // Use the configured Kysely instance
    provider: new FileMigrationProvider({
      fs,
      path,
      // The migration folder is relative to the project root
      migrationFolder: path.join(process.cwd(), "migrations"),
    }),
  });

  if (direction === "down") {
    const { error, results } = await migrator.migrateDown();
    results?.forEach((it) => {
      if (it.status === "Success") {
        console.log(
          `✅ Migration "${it.migrationName}" was reverted successfully`,
        );
      } else if (it.status === "Error") {
        console.error(`❌ Failed to revert migration "${it.migrationName}"`);
      }
    });
    if (error) {
      console.error("❌ Migration failed:", error);
      process.exit(1);
    }
  } else {
    const { error, results } = await migrator.migrateToLatest();
    results?.forEach((it) => {
      if (it.status === "Success") {
        console.log(
          `✅ Migration "${it.migrationName}" was executed successfully`,
        );
      } else if (it.status === "Error") {
        console.error(`❌ Failed to execute migration "${it.migrationName}"`);
      }
    });
    if (error) {
      console.error("❌ Migration failed:", error);
      process.exit(1);
    }
  }

  // Ensure the connection is closed
  await db.destroy();
}

const directionArg = Bun.argv[2];
if (directionArg !== "up" && directionArg !== "down") {
  console.error("Invalid argument. Use 'up' or 'down'.");
  process.exit(1);
}

migrate(directionArg).then(() => {
  console.log("✅ Done!");
});
