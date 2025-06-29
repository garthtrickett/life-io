// FILE: db/kysely.ts
import { config } from "dotenv";
import { Kysely } from "kysely";
import { neonConfig } from "@neondatabase/serverless";
import { NeonDialect } from "kysely-neon";
import ws from "ws";
import type { Database } from "../types";

// Load environment variables from .env file
config({ path: ".env" });

// We will determine the correct connection string inside our logic block.
let connectionString: string;

// Set the WebSocket constructor for Node.js/Bun environments.
neonConfig.webSocketConstructor = ws;

if (process.env.USE_LOCAL_NEON_PROXY === "true") {
  console.warn(
    "LOCAL DEV (PROXY): Configuring NeonDialect to connect via local proxy using DATABASE_URL_LOCAL.",
  );

  // --- CHANGED ---
  // Use the new DATABASE_URL_LOCAL variable when the proxy is enabled.
  connectionString = process.env.DATABASE_URL_LOCAL!;

  // Add a check to ensure it's actually set.
  if (!connectionString) {
    throw new Error(
      "USE_LOCAL_NEON_PROXY is true, but DATABASE_URL_LOCAL is not set in your .env file.",
    );
  }

  // This existing logic for the proxy is correct and remains unchanged.
  neonConfig.useSecureWebSocket = false;
  neonConfig.wsProxy = (host) => `${host}:3333/v1`;
  neonConfig.fetchEndpoint = (host) => `http://${host}:3333/sql`;
} else {
  // --- This block now handles both cloud environments and local dev without the proxy ---
  console.warn("DIRECT CONNECTION: Connecting to Neon using DATABASE_URL.");

  // This part remains the same, it correctly uses the main DATABASE_URL.
  connectionString = process.env.DATABASE_URL!;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL environment variable is not set for direct connection.",
    );
  }
}

// Create and export our Kysely instance. It will always use NeonDialect,
// and it will now be initialized with the correct connection string for the environment.
export const db = new Kysely<Database>({
  dialect: new NeonDialect({
    connectionString,
  }),
});
