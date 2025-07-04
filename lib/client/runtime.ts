// FILE: lib/client/runtime.ts
import { Effect, Runtime } from "effect";
import { clientLog } from "./logger.client";
import { LocationLive, type LocationService } from "./LocationService";

/**
 * A type alias for all services available in the client-side context.
 */
export type ClientContext = LocationService;

/**
 * A combined Layer that provides live implementations for all client-side services.
 */
export const ClientLive = LocationLive;

/**
 * Executes a client-side Effect and returns a Promise of its result.
 * Automatically provides all necessary client services.
 */
export const runClientPromise = <A, E>(
  effect: Effect.Effect<A, E, ClientContext>,
) => Effect.runPromise(Effect.provide(effect, ClientLive));

/**
 * Executes a client-side Effect in “fire-and-forget” mode.
 * Automatically provides all necessary client services.
 */
export const runClientUnscoped = <A, E>(
  effect: Effect.Effect<A, E, ClientContext>,
) => Effect.runFork(Effect.provide(effect, ClientLive));

// ───────────────────────────────────────────────────────────────────────────
// Global Error Logger Setup (Unchanged)
// ───────────────────────────────────────────────────────────────────────────
const setupGlobalErrorLogger = () => {
  const handler =
    (errorSource: string) => (event: ErrorEvent | PromiseRejectionEvent) => {
      let message = "Unknown error";
      let stack: string | undefined;

      const errorCandidate: unknown =
        "reason" in event ? event.reason : event.error;

      if (errorCandidate instanceof Error) {
        message = errorCandidate.message;
        stack = errorCandidate.stack;
      } else {
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

  window.addEventListener("error", handler("Uncaught Exception"));
  window.addEventListener("unhandledrejection", handler("Unhandled Rejection"));
  runClientUnscoped(
    clientLog("info", "Global error logger initialized.", undefined, "Runtime"),
  );
};

setupGlobalErrorLogger();
