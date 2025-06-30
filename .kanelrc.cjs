// ./.kanelrc.cjs
const { makeKyselyHook } = require("kanel-kysely");
const { config } = require("dotenv");

// Load environment variables from .env file first
config({ path: ".env" });

// Determine the correct connection string
let connectionString;

if (process.env.USE_LOCAL_NEON_PROXY === "true") {
  console.log("Kanel: Connecting to LOCAL database via proxy.");
  connectionString = process.env.DATABASE_URL_LOCAL;
} else {
  console.log("Kanel: Connecting to REMOTE database.");
  connectionString = process.env.DATABASE_URL;
}

if (!connectionString) {
  throw new Error(
    "Database connection string could not be determined for Kanel.",
  );
}

module.exports = {
  // Use the dynamically determined connection string
  connection: { connectionString },

  outputPath: "./types/generated",
  schemas: ["public"],

  preRenderHooks: [
    makeKyselyHook({
      useTypeImports: true,
    }),
  ],
};
