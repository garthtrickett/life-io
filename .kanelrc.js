const { makeKyselyHook } = require("kanel-kysely");

module.exports = {
  connection: { connectionString: process.env.DATABASE_URL },

  outputPath: "./types/generated",
  schemas: ["public"],

  preRenderHooks: [
    // Add the options object here
    makeKyselyHook({
      useTypeImports: true,
    }),
  ],

  // Optional: users -> User, notes -> Note
  // typeNameDecorator: (name) =>
  //   name.endsWith('s') ? name.slice(0, -1) : name,
};
