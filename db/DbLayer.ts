// FILE: db/DbLayer.ts
import { Layer } from "effect";
import { Db } from "./DbTag";
import { db as kyselyInstance } from "./kysely"; // Import our new instance

// Create a Layer that provides our pre-configured Kysely instance.
// The Effect-TS app can now depend on the `Db` tag to get the connection.
export const DbLayer = Layer.succeed(Db, kyselyInstance);
