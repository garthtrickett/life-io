// File: ./elysia/effectHandler.ts
import { Effect } from "effect";
import type { ServerContext } from "../lib/server/runtime";
import { runServerPromise } from "../lib/server/runtime";
import { serverLog } from "../lib/server/logger.server";
import { ApiError } from "./errors";

/**
 * Extracts the most specific error message from a caught value.
 * It prioritizes the top-level error message and appends the cause's message
 * for additional context, preventing information loss.
 */
function getErrorMessage(err: unknown): string {
  if (typeof err !== "object" || err === null) {
    return String(err);
  }

  const mainMessage = "message" in err ? String(err.message) : null;

  const causeMessage =
    "cause" in err &&
    typeof err.cause === "object" &&
    err.cause !== null &&
    "message" in err.cause
      ? String(err.cause.message)
      : null;

  if (mainMessage && causeMessage && mainMessage !== causeMessage) {
    // Combine both messages if they are distinct and both exist
    return `${mainMessage} (Caused by: ${causeMessage})`;
  }

  // Otherwise, return the first available message, prioritizing the main one
  return (
    mainMessage ??
    causeMessage ??
    "An unknown error occurred during processing."
  );
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
