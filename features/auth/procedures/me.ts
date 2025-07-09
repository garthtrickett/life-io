// File: ./features/auth/procedures/me.ts
import { publicProcedure } from "../../../trpc/trpc";

// Change from .query to .mutation to force POST requests
export const meProcedure = publicProcedure.mutation(({ ctx }) => {
  return ctx.user;
});
