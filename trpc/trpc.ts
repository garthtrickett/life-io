// FILE: ./trpc/trpc.ts
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "./context";
import { serverLog } from "../lib/server/logger.server";
import { runServerUnscoped } from "../lib/server/runtime";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

const loggerMiddleware = t.middleware(async ({ ctx, path, type, next }) => {
  const userId = ctx.user?.id;

  // Don't log the logger's own operations to avoid noise.
  if (path !== "log.log") {
    // Fire-and-forget the request log
    runServerUnscoped(
      serverLog("info", `tRPC → [${type}] ${path}`, userId, "tRPC:req"),
    );
  }

  // Await the result of the next middleware/procedure. This promise resolves
  // with a result object, it does not reject on application-level errors.
  const result = await next({ ctx });

  // Determine status based on the resolved result.
  const status = result.ok ? "OK" : "ERR";

  if (path !== "log.log") {
    // Fire-and-forget the response log
    runServerUnscoped(
      serverLog(
        "info",
        `tRPC ← [${type}] ${path} (${status})`,
        userId,
        "tRPC:res",
      ),
    );
  }

  // If the result contains a tRPC error, log its details.
  if (!result.ok) {
    const trpcError = result.error;
    runServerUnscoped(
      serverLog(
        "error",
        `tRPC Error on ${path}: Code=${trpcError.code}, Message=${trpcError.message}`,
        userId,
        "tRPC:Error",
      ),
    );
  }

  // IMPORTANT: Always return the original result object from `next()`.
  // This is crucial for preserving the error code and other metadata for the client.
  return result;
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
