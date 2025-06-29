// FILE: lib/client/runtime.ts
import { Runtime, Context } from "effect";

// --- FIX: Manually construct the config object for `Runtime.make` ---
// We use the default runtime's configuration for flags and refs,
// but explicitly provide our own empty context.
const clientRuntime = Runtime.make({
  context: Context.empty(),
  fiberRefs: Runtime.defaultRuntime.fiberRefs,
  runtimeFlags: Runtime.defaultRuntime.runtimeFlags,
});

/**
 * Executes a client-side Effect in the background without creating a Promise.
 * This is the idiomatic way to run "fire-and-forget" tasks.
 */
export const runClientEffect = Runtime.runFork(clientRuntime);
