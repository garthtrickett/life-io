// lib/server/runtime.ts
import { Runtime, Context } from "effect";
import { db as kyselyInstance } from "../../db/kysely";
import { Db } from "../../db/DbTag";

// 1. Create a Context that includes the database service.
const serverContext = Context.make(Db, kyselyInstance);

// 2. Build the runtime configuration, providing our new context
//    and borrowing the default flags and fiberRefs.
const serverRuntime = Runtime.make({
  context: serverContext,
  fiberRefs: Runtime.defaultRuntime.fiberRefs,
  runtimeFlags: Runtime.defaultRuntime.runtimeFlags,
});

/**
 * Executes a server-side Effect and returns a Promise of its result.
 * This should be used for all tRPC procedures that run Effects.
 */
export const runServerPromise = Runtime.runPromise(serverRuntime);

/**
 * Executes a server-side Effect in an unscoped manner, which is not tied
 * to the lifecycle of the parent fiber. This is suitable for top-level
 * "fire-and-forget" tasks that should not be interrupted, like logging
 * server startup.
 *
 * For tasks within a request, prefer `Effect.forkDaemon`.
 */
export const runServerUnscoped = Runtime.runFork(serverRuntime);
