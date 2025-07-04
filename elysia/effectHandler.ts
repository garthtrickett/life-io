// FILE: elysia/effectHandler.ts
import { Effect } from "effect";
import type { ServerContext } from "../lib/server/runtime";
import { runServerPromise } from "../lib/server/runtime";
import { serverLog } from "../lib/server/logger.server";
import { ApiError } from "./errors";

/**
 * Extracts the most specific error message from a caught value.
 * It intelligently prioritizes looking inside the `cause` property of our
 * custom tagged errors before falling back to a top-level message.
 */
function getErrorMessage(err: unknown): string {
  if (typeof err !== "object" || err === null) {
    return String(err);
  }

  // 1. Prioritize the `cause` if it's an object with its own message.
  // This is where the rich detail from DB errors, etc., is stored.
  if (
    "cause" in err &&
    typeof err.cause === "object" &&
    err.cause !== null &&
    "message" in err.cause
  ) {
    return String(err.cause.message);
  }

  // 2. Fallback to the top-level message if the cause isn't informative.
  if ("message" in err) {
    return String(err.message);
  }

  // 3. Final fallback for unusual error shapes.
  return "An unknown error occurred during processing.";
}

/**
 * Extracts a structured log tag from the error (_tag property).
 */
function extractTag(err: unknown): string {
  if (
    typeof err === "object" &&
    err !== null &&
    "_tag" in err &&
    typeof (err as { _tag: string })._tag === "string"
  ) {
    return (err as { _tag: string })._tag;
  }
  return "EffectHandler";
}

export const effectHandler =
  <A, E>(effect: Effect.Effect<A, E, ServerContext>) =>
  async (): Promise<A> => {
    try {
      return await runServerPromise(effect);
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      const tag = extractTag(err);

      // Log the detailed error message to the server console.
      await runServerPromise(
        serverLog("error", `[${tag}] ${message}`, undefined, "API_FAILURE"),
      );

      // Throw a new, clean error that our global onError handler can catch.
      // This error now contains the useful, specific message.
      throw new ApiError({
        message,
        cause: err, // Preserve the original error for the global handler
      });
    }
  };
