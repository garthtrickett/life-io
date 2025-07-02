// features/auth/procedures/me.ts
import { publicProcedure } from "../../../trpc/trpc";

export const meProcedure = publicProcedure.query(({ ctx }) => {
  return ctx.user;
});
