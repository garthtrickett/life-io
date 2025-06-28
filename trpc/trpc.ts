// File: ./trpc/trpc.ts
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson"; // 1. Import superjson
import type { Context } from "./context";

// 2. Add the transformer to the initTRPC call
const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

// The rest of the file remains exactly the same...
export const loggedInProcedure = t.procedure.use(async ({ ctx, next }) => {
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

  return t.procedure.use(
    t.middleware(({ ctx, next }) => {
      if (!ctx.user || !ctx.session) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      const userPermissions = ctx.user.permissions || [];
      const hasAllPerms = needed.every((p) => userPermissions.includes(p));
      if (!hasAllPerms) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to perform this action.",
        });
      }
      return next({
        ctx: {
          ...ctx,
          user: ctx.user,
          session: ctx.session,
        },
      });
    }),
  );
}
