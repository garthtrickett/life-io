// trpc/routers/log.ts
import { Effect } from "effect";
import { Schema } from "@effect/schema";
import { publicProcedure, router } from "../trpc";
import { s } from "../validator";
import { serverLog } from "../../lib/server/logger.server";
import type { LogLevel } from "../../lib/shared/logConfig";

// A validator to ensure the client sends a valid log level string.
// This now correctly omits 'silent' for the server-side log function.
const isLoggableLevel = (l: string): l is Exclude<LogLevel, "silent"> =>
  ["info", "error", "warn", "debug"].includes(l);

const LogInput = Schema.Struct({
  level: Schema.String.pipe(Schema.filter(isLoggableLevel)),
  args: Schema.Array(Schema.Unknown),
});

export const logRouter = router({
  /**
   * A tRPC mutation that receives a log entry from the client
   * and forwards it to the server's logger.
   */
  log: publicProcedure.input(s(LogInput)).mutation(({ input, ctx }) => {
    const { level, args } = input;
    const userId = ctx.user?.id;
    const message = args.map(String).join(" ");

    // The level is now guaranteed to be a valid level for serverLog,
    // so no extra 'if' check is needed.
    Effect.runFork(
      serverLog(level, `[CLIENT] ${message}`, userId, "ClientLog"),
    );
  }),
});
