// features/auth/procedures/logout.ts
import { Effect } from "effect";
import { loggedInProcedure } from "../../../trpc/trpc";
import { deleteSessionEffect } from "../../../lib/server/auth";
import { handleTrpcProcedure } from "../../../lib/server/runtime";
import { serverLog } from "../../../lib/server/logger.server";

export const logoutProcedure = loggedInProcedure.mutation(({ ctx }) => {
  const program = Effect.gen(function* () {
    yield* serverLog(
      "info",
      { user: ctx.user },
      "User initiated logout.",
      "auth:logout",
    );
    yield* deleteSessionEffect(ctx.session.id);
    // --- LOGGING ---
    yield* serverLog(
      "info", // level
      { user: ctx.user }, // data
      "Logout procedure completed successfully on server.",
      "auth:logout",
    );
    // --- LOGGING ---
    return { success: true };
  });
  return handleTrpcProcedure(program);
});
