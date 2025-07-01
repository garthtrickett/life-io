// FILE: db/kysely.ts
import { Kysely } from "kysely";
import { neonConfig } from "@neondatabase/serverless";
import { NeonDialect } from "kysely-neon";
import ws from "ws";
import type { Database } from "../types";
import { Effect } from "effect";
import { Config, ConfigLive } from "../lib/server/Config";

// Use an Effect to load the configuration and create the database instance.
const makeDb = Effect.gen(function* () {
  const config = yield* Config;
  const { connectionString, useLocalProxy } = config.neon;

  // We will determine the correct connection string inside our logic block.
  // Set the WebSocket constructor for Node.js/Bun environments.
  neonConfig.webSocketConstructor = ws;

  if (useLocalProxy) {
    yield* Effect.logInfo(
      "LOCAL DEV (PROXY): Configuring NeonDialect to connect via local proxy.",
    );
    // This existing logic for the proxy is correct and remains unchanged.
    neonConfig.useSecureWebSocket = false;
    neonConfig.wsProxy = (host) => `${host}:3333/v1`;
    neonConfig.fetchEndpoint = (host) => `http://${host}:3333/sql`;
  } else {
    // This block now handles both cloud environments and local dev without the proxy
    yield* Effect.logInfo("DIRECT CONNECTION: Connecting to Neon.");
  }

  // Create and return our Kysely instance. It will always use NeonDialect,
  // and it will now be initialized with the correct connection string for the environment.
  return new Kysely<Database>({
    dialect: new NeonDialect({
      connectionString,
    }),
  });
});

// To maintain the global `db` export without a major refactor, we
// run the effect synchronously at startup. This is a pragmatic choice.
const dbProgram = Effect.provide(makeDb, ConfigLive);
export const db = Effect.runSync(dbProgram);
