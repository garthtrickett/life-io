// FILE: db/DbLayer.ts
// --- Fix: Corrected the Effect Layer construction syntax ---
import { Effect, Layer } from "effect";
import { Kysely } from "kysely";
import { BunPgDialect } from "../lib/kysely-bun-dialect";
import { Db } from "./DbTag";
import type { Database } from "../types";

// This is the correct way to create a scoped layer for a service tag.
// The first argument is the Tag (Db), and the second is the Effect
// that provides the implementation.
export const DbLayer = Layer.scoped(
  Db,
  Effect.acquireRelease(
    Effect.sync(() => new Kysely<Database>({ dialect: new BunPgDialect() })),
    (db) => Effect.promise(() => db.destroy()),
  ),
);
