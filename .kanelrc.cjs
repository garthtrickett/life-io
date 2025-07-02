// ./.kanelrc.cjs
const { makeKyselyHook } = require("kanel-kysely");
const { config } = require("dotenv");

config({ path: ".env" });

// If USE_LOCAL_NEON_PROXY is explicitly 'true', use the local URL.
// Otherwise, fall back to the primary DATABASE_URL for production or other setups.
const connectionString =
  process.env.USE_LOCAL_NEON_PROXY === "true"
    ? process.env.DATABASE_URL_LOCAL
    : process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "Kanel could not determine a database connection string. Ensure DATABASE_URL is set.",
  );
}

console.log(
  `Kanel: Using connection string for ${process.env.USE_LOCAL_NEON_PROXY === "true" ? "LOCAL" : "REMOTE"} environment.`,
);

module.exports = {
  connection: { connectionString },
  outputPath: "./types/generated",
  schemas: ["public"],
  preRenderHooks: [
    makeKyselyHook({
      useTypeImports: true,
    }),
  ],
};
