// File: trpc/context.ts
import { Cause, Effect, Option } from "effect";
import type { User } from "../types/generated/public/User";
import type { Kysely } from "kysely";
import { TRPCError } from "@trpc/server";
import {
  validateSessionEffect,
  getSessionIdFromRequest,
} from "../lib/server/auth";
import { runServerPromise, runServerUnscoped } from "../lib/server/runtime";
import { serverLog } from "../lib/server/logger.server";
import type { Database } from "../types";
import { Db } from "../db/DbTag";

// This is the shape of the context object from Elysia's handler.
// It's the input to our createContext function.
export interface ElysiaContext {
  request: Request;
  ip: string; // Add the IP address property
}

// This is the final shape of the context our tRPC procedures will receive.
export interface Context {
  readonly db: Kysely<Database>;
  readonly user: User | null;
  readonly session: { id: string } | null;
  readonly ip: string; // Add the IP address property
}

// This effect takes the Elysia context and produces the tRPC context.
const createContextEffect = (
  ctx: ElysiaContext,
): Effect.Effect<Context, Error, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;
    // The request object is inside ctx.request
    const sessionIdOption = yield* getSessionIdFromRequest(ctx.request);

    // Pass the ip through to the final context
    const baseContext = { db, ip: ctx.ip }; // Pass the IP to our base context

    return yield* Option.match(sessionIdOption, {
      onNone: () =>
        Effect.succeed({ ...baseContext, user: null, session: null }),
      onSome: (sessionId) =>
        Effect.gen(function* () {
          const { user, session } = yield* validateSessionEffect(sessionId);
          return { ...baseContext, user, session };
        }),
    });
  });

// The public createContext function, which will be called by our adapter.
export const createContext = async (ctx: ElysiaContext): Promise<Context> => {
  try {
    // This now correctly receives the Elysia context.
    return await runServerPromise(createContextEffect(ctx));
  } catch (err) {
    const cause = Cause.isCause(err) ? err : Cause.die(err);
    runServerUnscoped(
      serverLog(
        "error",
        { cause: Cause.pretty(cause) },
        "[FATAL] tRPC context creation failed",
        "tRPC:Context:Fatal",
      ),
    );
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create request context.",
      cause: err,
    });
  }
};
