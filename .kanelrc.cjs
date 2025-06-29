const { makeKyselyHook } = require("kanel-kysely");

module.exports = {
  connection: { connectionString: process.env.DATABASE_URL },

  outputPath: "./types/generated",
  schemas: ["public"],

  preRenderHooks: [
    makeKyselyHook({
      useTypeImports: true,
    }),
  ],
};
