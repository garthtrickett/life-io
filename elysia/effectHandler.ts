import { Effect } from "effect";
import type { ServerContext } from "../lib/server/runtime";
import { runServerPromise } from "../lib/server/runtime";
import { serverLog } from "../lib/server/logger.server";
import { toError } from "../lib/shared/toError";

/* ───────────────────────────── Utilities ────────────────────────────────── */

/** Extract an Effect-style `_tag` for structured logs, if present. */
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
 * 3. Logs the error consistently
 * 4. Re-throws so Elysia still produces a 500 + stack
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
      // 2️⃣ Normalise without relying on `instanceof`
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
