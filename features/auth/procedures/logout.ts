// features/auth/procedures/logout.ts
import { Effect } from "effect";
import { loggedInProcedure } from "../../../trpc/trpc";
import { deleteSessionEffect } from "../../../lib/server/auth";
import { runServerPromise } from "../../../lib/server/runtime";
import { serverLog } from "../../../lib/server/logger.server";

export const logoutProcedure = loggedInProcedure.mutation(({ ctx }) => {
  const program = Effect.gen(function* () {
    yield* serverLog(
      "info",
      `User initiated logout.`,
      ctx.user.id,
      "auth:logout",
    );
    yield* deleteSessionEffect(ctx.session.id);
    return { success: true };
  });
  return runServerPromise(program);
});
