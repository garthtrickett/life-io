// scripts/migrate.ts
import { Kysely, Migrator, FileMigrationProvider } from "kysely";
import { BunPgDialect } from "../lib/kysely-bun-dialect";
import * as path from "path";
import { promises as fs } from "fs";

async function migrate(direction: "up" | "down") {
  const db = new Kysely<any>({
    dialect: new BunPgDialect(),
  });

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      // This needs to be an absolute path to your migrations folder.
      migrationFolder: path.join(import.meta.dir, "../migrations"),
    }),
  });

  if (direction === "up") {
    console.log("Running migrations up...");
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
      console.error("Failed to migrate");
      console.error(error);
      process.exit(1);
    }
  } else if (direction === "down") {
    console.log("Running migrations down...");
    const { error, results } = await migrator.migrateDown();

    results?.forEach((it) => {
      if (it.status === "Success") {
        console.log(
          `⏮️ Migration "${it.migrationName}" was reverted successfully`,
        );
      } else if (it.status === "Error") {
        console.error(`❌ Failed to revert migration "${it.migrationName}"`);
      }
    });

    if (error) {
      console.error("Failed to migrate down");
      console.error(error);
      process.exit(1);
    }
  }

  await db.destroy();
}

// Bun passes script arguments after the script name, so the argument is at index 2.
const direction = (process.argv[2] as "up" | "down") ?? "up";

migrate(direction);
