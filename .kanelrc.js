import { makeKyselyHook } from "kanel-kysely";

export default {
  connection: { connectionString: process.env.DATABASE_URL },

  outputPath: "./types/generated",
  schemas: ["public"],

  preRenderHooks: [makeKyselyHook()],

  // Optional: users -> User, notes -> Note
  // typeNameDecorator: (name) =>
  //   name.endsWith('s') ? name.slice(0, -1) : name,
};
