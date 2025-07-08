// lib/client/replicache/helpers.ts
import { Effect, pipe } from "effect";
import { clientLog } from "../logger.client";

/**
 * A reusable logging wrapper for Replicache mutators.
 * It catches any error, logs it, and ensures the mutator promise resolves.
 * @param name The name of the mutator for logging.
 */
export const withMutatorLogging =
  <A, E, R>(name: string) =>
  (self: Effect.Effect<A, E, R>): Effect.Effect<A | void, never, R> =>
    pipe(
      self,
      // START OF FIX: The catchAll block now logs the full error object.
      Effect.catchAll((err) =>
        clientLog("error", `Error in ${name} mutator:`, err),
      ),
      // END OF FIX
    );
