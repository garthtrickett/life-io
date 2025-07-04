import { Effect } from "effect";
import type { ServerContext } from "../lib/server/runtime";
import { runServerPromise } from "../lib/server/runtime";
import { serverLog } from "../lib/server/logger.server";

/* ───────────────────────────── Utilities ────────────────────────────────── */

/**
 * Convert any thrown value into a *plain* `Error` instance, defensively
 * accessing properties to avoid prototype issues in multi-realm environments like Bun.
 */
const toError = (err: unknown): Error => {
  // Create a new Error in the current realm to ensure a valid prototype chain.
  const newError = new Error();

  if (typeof err === "object" && err !== null) {
    const errAsRecord = err as Record<string, unknown>;

    // Safely copy the 'message' property if it's a string.
    if (typeof errAsRecord.message === "string") {
      newError.message = errAsRecord.message;
    } else {
      newError.message =
        "An error object with a non-string or missing message was thrown.";
    }

    // Safely copy the 'stack' property.
    if (typeof errAsRecord.stack === "string") {
      newError.stack = errAsRecord.stack;
    }

    // Safely copy the 'name' property.
    if (typeof errAsRecord.name === "string") {
      newError.name = errAsRecord.name;
    }

    // Preserve the Effect-style '_tag' for better structured logging.
    if (typeof errAsRecord._tag === "string") {
      Object.assign(newError, { _tag: errAsRecord._tag });
    }
  } else {
    // Handle cases where the thrown value is not an object.
    try {
      newError.message = String(err);
    } catch {
      newError.message = "[Unstringifiable value thrown]";
    }
  }

  return newError;
};

/** Extract an Effect‑style `_tag` for structured logs, if present.
 */
const extractTag = (err: unknown): string =>
  typeof err === "object" &&
  err !== null &&
  "_tag" in err &&
  typeof (err as Record<string, unknown>)._tag === "string"
    ? (err as Record<string, string>)._tag
    : "EffectHandler";

/* ───────────────────────────── Public API ───────────────────────────────── */

/**
 * Turn an `Effect` program into an async handler that:
 * 1. Runs inside the shared server runtime
 * 2. Normalises *any* thrown value into a real `Error`
 * 3. Logs the error in a consistent format
 * 4. Re‑throws so Elysia still produces a 500 + stack
 */
export const effectHandler =
  <A, E extends { _tag?: string; message?: unknown }>(
    effect: Effect.Effect<A, E, ServerContext>,
  ) =>
  async (): Promise<A> => {
    try {
      // 1️⃣ Run the program inside the server runtime
      return await runServerPromise(effect);
    } catch (err: unknown) {
      // 2️⃣ Normalise error without relying on `instanceof` or prototypes
      const normalised = toError(err);
      // 3️⃣ Structured log with tag (if present)
      await runServerPromise(
        serverLog(
          "error",
          `effectHandler error: ${normalised.message}`,
          undefined,
          extractTag(err),
        ),
      );
      // 4️⃣ Bubble up so framework returns 500 / stack trace
      throw normalised;
    }
  };
