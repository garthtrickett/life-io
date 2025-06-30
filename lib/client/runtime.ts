// lib/client/runtime.ts
import { Runtime } from "effect";

/**
 * The default Effect runtime for the client-side.
 * It does not require any special context like the server-side runtime.
 */
const clientRuntime = Runtime.defaultRuntime;

/**
 * Executes a client-side Effect and returns a Promise of its result.
 * This should be used for operations where the UI needs to react to the
 * completion or failure of the effect (e.g., data fetching, mutations).
 */
export const runClientPromise = Runtime.runPromise(clientRuntime);

/**
 * Executes a client-side Effect in a "fire-and-forget" manner.
 * This is suitable for tasks that should not block rendering and where the
 * result is not directly needed, such as logging.
 */
export const runClientUnscoped = Runtime.runFork(clientRuntime);
