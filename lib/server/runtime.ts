// lib/server/runtime.ts
import { Runtime, Context } from "effect";
import { db as kyselyInstance } from "../../db/kysely";
import { Db } from "../../db/DbTag";

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
 * [cite_start]This should be used for all tRPC procedures that run Effects. [cite: 1958]
 */
export const runServerPromise = Runtime.runPromise(serverRuntime);

/**
 * Executes a server-side Effect in an unscoped manner, which is not tied
 * to the lifecycle of the parent fiber. [cite_start]This is suitable for top-level [cite: 1959]
 * "fire-and-forget" tasks that should not be interrupted, like logging
 * server startup.
 *
 * [cite_start]For tasks within a request, prefer `Effect.forkDaemon`. [cite: 1960]
 */
export const runServerUnscoped = Runtime.runFork(serverRuntime);
