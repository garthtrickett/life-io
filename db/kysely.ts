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

// --- FIX: This check is now more robust ---
// It no longer depends on NODE_ENV, which might not be set.
// It now correctly triggers the local proxy settings whenever
// USE_LOCAL_NEON_PROXY is set to 'true' in your .env file.
if (process.env.USE_LOCAL_NEON_PROXY === "true") {
  console.warn(
    "LOCAL DEV: Configuring NeonDialect to connect via local proxy on port 3333.",
  );

  // Use the DATABASE_URL from the .env file for local development.
  connectionString = process.env.DATABASE_URL!;

  // The local proxy serves traffic over unencrypted connections.
  neonConfig.useSecureWebSocket = false;
  // Point the WebSocket proxy to the local proxy's v1 endpoint.
  // The `host` variable will be 'localhost', and the port is the proxy's external port.
  neonConfig.wsProxy = (host) => `${host}:3333/v1`;
  // Point the fetch/HTTP endpoint to the local proxy's SQL endpoint.
  neonConfig.fetchEndpoint = (host) => `http://${host}:3333/sql`;
} else {
  console.warn("CLOUD ENV: Connecting to Neon using NeonDialect (WebSocket).");
  // For cloud environments, we use the DATABASE_URL from the environment.
  connectionString = process.env.DATABASE_URL!;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL environment variable is not set for cloud environment",
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
