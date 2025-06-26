import { BunPgDialect } from "../lib/kysely-bun-dialect";
import { Kysely } from "kysely";
import { centralMigrationObjects } from "../lib/server/migrations/central-migrations-manifest";

export async function runMigrations(direction: "up" | "down") {
  const db = new Kysely({ dialect: new BunPgDialect() });

  try {
    const migrations = Object.entries(centralMigrationObjects)
      .sort(([a], [b]) => a.localeCompare(b)) // chronological
      .map(([id, mig]) => ({ id, ...mig }));

    for (const m of migrations) {
      console.log(`${direction === "up" ? "▶" : "⏮️"}  ${m.id}`);
      if (direction === "up") {
        if (m.up) {
          await m.up(db);
        }
      } else {
        if (m.down) {
          await m.down(db);
        }
      }
    }
  } finally {
    await db.destroy();
  }
}
