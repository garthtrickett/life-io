// FILE: lib/server/runtime.ts
import { Runtime, Context } from "effect";
import { db as kyselyInstance } from "../../db/kysely";
import { Db } from "../../db/DbTag";

// --- FIX: Manually build the Context and the Runtime configuration ---

// 1. Create a Context that includes the database service.
//    This is the equivalent of what DbLayer provides.
const serverContext = Context.make(Db, kyselyInstance);

// 2. Build the runtime configuration, providing our new context
//    and borrowing the default flags and fiberRefs.
const serverRuntime = Runtime.make({
  context: serverContext,
  fiberRefs: Runtime.defaultRuntime.fiberRefs,
  runtimeFlags: Runtime.defaultRuntime.runtimeFlags,
});

/**
 * Executes a server-side Effect in the background without creating a Promise.
 * This is the idiomatic way to run "fire-and-forget" tasks on the server.
 */
export const runServerEffect = Runtime.runFork(serverRuntime);
