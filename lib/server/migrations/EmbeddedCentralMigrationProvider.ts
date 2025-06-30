// lib/server/migrations/EmbeddedCentralMigrationProvider.ts
import type { Migration, MigrationProvider } from "kysely";
import { centralMigrationObjects } from "./central-migrations-manifest";

export class EmbeddedCentralMigrationProvider implements MigrationProvider {
  getMigrations(): Promise<Record<string, Migration>> {
    return Promise.resolve(centralMigrationObjects);
  }
}
