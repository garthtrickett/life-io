// FILE: db/DbLayer.ts
import { Layer } from "effect";
import { Db } from "./DbTag";
// --- MODIFIED ---
// Import the effect that creates the db instance instead of the instance itself.
import { makeDbLive } from "./kysely";

// --- MODIFIED ---
// The DbLayer is now an effectful layer. It describes HOW to create the
// Kysely instance by using the `makeDbLive` effect. The Effect runtime
// will manage its lifecycle (creation and destruction).
export const DbLayer = Layer.effect(Db, makeDbLive);
