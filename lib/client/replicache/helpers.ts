// lib/client/replicache/helpers.ts
import { Effect, pipe } from "effect";
import { clientLog } from "../logger.client";
import { toError } from "../../shared/toError";

/** Safely stringify anything for logging so we avoid @typescript-eslint/no-base-to-string */
export function stringifyForLog(value: unknown): string {
  if (value == null) return ""; // null | undefined
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (value instanceof Error) return value.message;

  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

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
      Effect.catchAll((err) => {
        const error = toError(err);
        const cause =
          error.cause !== undefined
            ? ` | Cause: ${stringifyForLog(error.cause)}`
            : "";
        return clientLog(
          "error",
          `Error in ${name} mutator: ${error.message}${cause}`,
        );
      }),
    );
