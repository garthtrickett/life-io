// FILE: /trpc/trpc.ts
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "./context";
import { serverLog } from "../lib/server/logger.server";
import { runServerPromise } from "../lib/server/runtime";
import { Effect } from "effect";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

const loggerMiddleware = t.middleware(({ ctx, path, type, next }) => {
  const program = Effect.gen(function* () {
    const userId = ctx.user?.id;

    // Don't log the logger's own operations to avoid noise.
    if (path !== "log.log") {
      yield* Effect.forkDaemon(
        serverLog("info", `tRPC → [${type}] ${path}`, userId, "tRPC:req"),
      );
    }

    const result = yield* Effect.tryPromise({
      try: () => next({ ctx }),
      catch: (e) => e as Error,
    });

    const status = result.ok && !("error" in result) ? "OK" : "ERR";

    // Apply the same check to the response log.
    if (path !== "log.log") {
      yield* Effect.forkDaemon(
        serverLog(
          "info",
          `tRPC ← [${type}] ${path} (${status})`,
          userId,
          "tRPC:res",
        ),
      );
    }

    if (!result.ok && "error" in result) {
      return yield* Effect.fail(result.error);
    }

    return result;
  });

  return runServerPromise(program);
});

export const router = t.router;
export const publicProcedure = t.procedure.use(loggerMiddleware);

export const loggedInProcedure = publicProcedure.use(async ({ ctx, next }) => {
  if (!ctx.user || !ctx.session) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      session: ctx.session,
    },
  });
});

export function createPermissionProtectedProcedure(
  requiredPerms: string | string[],
) {
  const needed = Array.isArray(requiredPerms) ? requiredPerms : [requiredPerms];

  return loggedInProcedure.use(({ ctx, next }) => {
    const userPerms = ctx.user.permissions ?? [];
    const allowed = needed.every((p) => userPerms.includes(p));
    if (!allowed) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You do not have permission to perform this action.",
      });
    }
    return next();
  });
}
