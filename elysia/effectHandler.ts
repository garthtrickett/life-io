// FILE: elysia/effectHandler.ts
/* -------------------------------------------------------------------------- */
/*  elysia/effectHandler.ts                                                   */
/* -------------------------------------------------------------------------- */

import { Effect } from "effect";
import type { ServerContext } from "../lib/server/runtime";
import { runServerPromise } from "../lib/server/runtime";
import { serverLog } from "../lib/server/logger.server";

/* ───────────────────────────── Utilities ────────────────────────────────── */

/** JSON-stringify any value defensively so we always get something readable. */
const toReadable = (value: unknown): string => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value); // fallback for circular refs etc.
  }
};

/** Normalise an unknown error into a plain `Error` instance. */
const toError = (err: unknown): Error => {
  if (err instanceof Error) return err;

  if (typeof err === "object" && err !== null) {
    const { _tag, message } = err as { _tag?: string; message?: unknown };
    const e = new Error(
      message !== undefined ? toReadable(message) : "Unknown error",
    );
    if (_tag) Object.assign(e, { _tag });
    return e;
  }
  return new Error(typeof err === "string" ? err : "Unknown error");
};

/** Safely pull an Effect-style `_tag` off any value for structured logs. */
const extractTag = (err: unknown): string =>
  typeof err === "object" &&
  err !== null &&
  "_tag" in err &&
  typeof (err as Record<string, unknown>)._tag === "string"
    ? (err as Record<string, string>)._tag
    : "EffectHandler";

/* ───────────────────────────── Public API ───────────────────────────────── */

export const effectHandler =
  <A, E extends { _tag?: string; message?: unknown }>(
    effect: Effect.Effect<A, E, ServerContext>,
  ) =>
  async (): Promise<A> => {
    try {
      // run the program inside the shared server runtime
      return await runServerPromise(effect);
    } catch (err: unknown) {
      // 1️⃣ normalise for re-throw
      const normalised = toError(err);

      // 2️⃣ log in the same runtime for consistent transport (Pino/BetterStack)
      await runServerPromise(
        serverLog(
          "error",
          `effectHandler error: ${normalised.message}`,
          undefined,
          extractTag(err),
        ),
      );

      // 3️⃣ bubble up so Elysia still sends a 500/stack
      throw normalised;
    }
  };
