import { Effect, Context } from "effect";
import type { ServerContext } from "../lib/server/runtime";
import { runServerPromise } from "../lib/server/runtime";

/* -------------------------------------------------------------------------------------------------
 * Utilities
 * -------------------------------------------------------------------------------------------------*/
/** Serialise an arbitrary value into a readable string. */
const toReadable = (value: unknown): string => {
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    // As a last resort fall back to String(); JSON may choke on circular refs
    return String(value);
  }
};

/**
 * Convert any thrown value into an `Error`, preserving an optional `_tag`.
 * Ensures the `message` is always a string, avoiding Object's default
 * stringification (`[object Object]`).
 */
const toError = (err: unknown): Error => {
  if (err instanceof Error) {
    return err;
  }

  if (typeof err === "object" && err !== null) {
    const { _tag, message } = err as {
      _tag?: string;
      message?: unknown;
    };

    const error = new Error(
      message !== undefined ? toReadable(message) : "Unknown error",
    );

    return _tag ? Object.assign(error, { _tag }) : error;
  }

  return new Error(typeof err === "string" ? err : "Unknown error");
};

/* -------------------------------------------------------------------------------------------------
 * Public API
 * -------------------------------------------------------------------------------------------------*/
/**
 * Wrap an `Effect` so it can be used as an Elysia route handler.
 *
 * 1. Inject request-scoped values (`ctx`) via `Effect.provide`.
 * 2. Pass the partially-provided effect to `runServerPromise`, which supplies
 *    the remaining `ServerContext` services and executes it.
 * 3. Normalise all thrown values to `Error` objects with an optional `_tag`.
 */
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
      /* ③ error normalisation */
      throw toError(err);
    }
  };
