// FILE: lib/client/runtime.ts
import { Runtime } from "effect";
import { clientLog } from "./logger.client";

/**
 * The default Effect runtime for the client-side.
 * It does not require any special context like the server-side runtime.
 */
const clientRuntime = Runtime.defaultRuntime;

/**
 * Executes a client-side Effect and returns a Promise of its result.
 * Use when the UI needs to react to the completion or failure of the Effect.
 */
export const runClientPromise = Runtime.runPromise(clientRuntime);

/**
 * Executes a client-side Effect in “fire-and-forget” mode.
 * Ideal for tasks such as logging where the result isn’t needed immediately.
 */
export const runClientUnscoped = Runtime.runFork(clientRuntime);

// ───────────────────────────────────────────────────────────────────────────
// Global Error Logger Setup
// ───────────────────────────────────────────────────────────────────────────
const setupGlobalErrorLogger = () => {
  const handler =
    (errorSource: string) => (event: ErrorEvent | PromiseRejectionEvent) => {
      let message = "Unknown error";
      let stack: string | undefined;

      // The `reason` property on PromiseRejectionEvent is `any`.
      // The `error` property on ErrorEvent is `any`.
      // We need to safely extract details.
      const errorCandidate: unknown =
        "reason" in event ? event.reason : event.error;

      if (errorCandidate instanceof Error) {
        message = errorCandidate.message;
        stack = errorCandidate.stack;
      } else {
        // Fallback for non-error objects (e.g., strings, numbers)
        message = String(errorCandidate);
      }

      runClientUnscoped(
        clientLog(
          "error",
          `[GLOBAL CATCH – ${errorSource}] ${message}`,
          undefined,
          stack ? `STACK: ${stack}` : "No stack available",
        ),
      );
    };

  // Catch uncaught exceptions
  window.addEventListener("error", handler("Uncaught Exception"));

  // Catch unhandled promise rejections
  window.addEventListener("unhandledrejection", handler("Unhandled Rejection"));

  runClientUnscoped(
    clientLog("info", "Global error logger initialized.", undefined, "Runtime"),
  );
};

// Initialise the global error logger immediately
setupGlobalErrorLogger();
