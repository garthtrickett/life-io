// FILE: elysia/effectHandler.ts

/* -------------------------------------------------------------------------- */
/*  elysia/effectHandler.ts                                                   */
/* -------------------------------------------------------------------------- */

import { Effect, Context } from "effect";
import type { ServerContext } from "../lib/server/runtime";
import { runServerPromise } from "../lib/server/runtime";
import { serverLog } from "../lib/server/logger.server";

/* ───────────────────────────── Utilities ────────────────────────────────── */

const toReadable = (value: unknown): string => {
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value); // circular ref fallback
  }
};

const toError = (err: unknown): Error => {
  if (err instanceof Error) return err;

  if (typeof err === "object" && err !== null) {
    const { _tag, message } = err as { _tag?: string; message?: unknown };
    const e = new Error(
      message !== undefined ? toReadable(message) : "Unknown error",
    );
    return _tag ? Object.assign(e, { _tag }) : e;
  }

  return new Error(typeof err === "string" ? err : "Unknown error");
};

/* ───────────────────────────── Public API ───────────────────────────────── */

export const effectHandler =
  <A, E extends { readonly _tag?: string; readonly message?: unknown }>(
    effect: Effect.Effect<A, E, ServerContext>,
  ) =>
  async (ctx: Partial<ServerContext>): Promise<A> => {
    try {
      /* ① per-request injection */
      const withCtx = Effect.provide(
        effect,
        ctx as unknown as Context.Context<Partial<ServerContext>>,
      ) as Effect.Effect<A, E, ServerContext>;

      /* ② shared-services injection + run */
      return await runServerPromise(withCtx);
    } catch (err: unknown) {
      /* ③ error normalisation + extra visibility -------------------------- */
      const normalised = toError(err);

      // --- START OF FIX ---
      // Safely access the _tag from the original error object.
      const tag =
        typeof err === "object" &&
        err !== null &&
        "_tag" in err &&
        typeof err._tag === "string"
          ? err._tag
          : "EffectHandler";

      /* log through Effect so it reaches Bun/BetterStack */
      await runServerPromise(
        serverLog(
          "error",
          `effectHandler error: ${normalised.message}`,
          undefined,
          tag,
        ),
      );
      // --- END OF FIX ---

      throw normalised; // still propagate so the framework returns 500/stack
    }
  };
