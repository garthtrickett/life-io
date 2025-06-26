import type {
  CompiledQuery,
  DatabaseConnection,
  Dialect,
  DialectAdapter,
  Driver,
  DatabaseIntrospector,
  Kysely,
  QueryCompiler,
  QueryResult,
} from "kysely";
import { sql as bunSql } from "bun";

export class BunPgDialect implements Dialect {
  createAdapter(): DialectAdapter {
    return {
      // This is the key change. Bun's built-in SQL driver has safety
      // features that are incompatible with how Kysely handles
      // transactional Data Definition Language (DDL) by default.
      // Setting this to `false` tells Kysely not to wrap schema
      // changes (like CREATE TABLE) in a transaction, which avoids the error.
      supportsTransactionalDdl: false,
      supportsReturning: true,
      supportsCreateIfNotExists: true,
      async acquireMigrationLock() {},
      async releaseMigrationLock() {},
    };
  }

  createDriver(): Driver {
    return new BunPgDriver();
  }

  createQueryCompiler(): QueryCompiler {
    const { PostgresQueryCompiler } = require("kysely");
    return new PostgresQueryCompiler();
  }

  createIntrospector(db: Kysely<any>): DatabaseIntrospector {
    const { PostgresIntrospector } = require("kysely");
    return new PostgresIntrospector(db);
  }
}

/* ---------- driver & connection ---------- */

class BunPgDriver implements Driver {
  async init() {}

  async acquireConnection(): Promise<DatabaseConnection> {
    return new BunPgConnection();
  }

  async releaseConnection(_conn: DatabaseConnection): Promise<void> {}

  async beginTransaction() {
    await bunSql`BEGIN`;
  }
  async commitTransaction() {
    await bunSql`COMMIT`;
  }
  async rollbackTransaction() {
    await bunSql`ROLLBACK`;
  }

  async destroy() {}
}

class BunPgConnection implements DatabaseConnection {
  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    const { sql, parameters } = query;
    const rows = (await bunSql.unsafe(sql, parameters as any[])) as R[];
    return {
      rows,
    };
  }

  async *streamQuery<R>(
    _query: CompiledQuery,
    _chunkSize: number,
  ): AsyncIterableIterator<QueryResult<R>> {
    throw new Error("Streaming not implemented");
  }
}
