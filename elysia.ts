// File: ./elysia.ts
import { Cause, Effect, Exit, Schedule, Duration, pipe } from "effect";
import { makeApp } from "./elysia/routes";
import {
  ServerLive,
  runServerPromise,
  runServerUnscoped,
} from "./lib/server/runtime";
import { serverLog } from "./lib/server/logger.server";
import {
  cleanupExpiredTokensEffect,
  retryFailedEmailsEffect,
} from "./lib/server/jobs";

/**
 * The main application setup effect.
 * It creates the Elysia app and schedules background jobs.
 */
const setupApp = Effect.gen(function* () {
  const app = yield* makeApp;

  // --- Scheduled Jobs ---
  yield* Effect.forkDaemon(
    pipe(
      cleanupExpiredTokensEffect,
      Effect.repeat(Schedule.spaced(Duration.hours(24))),
      Effect.tapError((e) =>
        serverLog(
          "error",
          `Token cleanup job failed: ${e.message}`,
          undefined,
          "Job:TokenCleanup",
        ),
      ),
    ),
  );

  yield* Effect.forkDaemon(
    pipe(
      retryFailedEmailsEffect,
      Effect.repeat(
        Schedule.intersect(
          Schedule.exponential(Duration.minutes(1)),
          Schedule.recurs(5),
        ),
      ),
      Effect.tapError((e) =>
        serverLog(
          "error",
          `Email retry job failed: ${e.message}`,
          undefined,
          "Job:EmailRetry",
        ),
      ),
    ),
  );

  return app;
});

// --- Application Entry Point ---
const program = Effect.provide(setupApp, ServerLive);

void Effect.runPromiseExit(program).then((exit) => {
  if (Exit.isSuccess(exit)) {
    const app = exit.value;
    const server = app.listen(42069, () => {
      runServerUnscoped(
        serverLog(
          "info",
          `🦊 Elysia server with tRPC listening on http://localhost:42069`,
          undefined,
          "Startup",
        ),
      );
    });

    const gracefulShutdown = async (signal: string) => {
      console.info(`\nReceived ${signal}. Shutting down gracefully...`);
      await server.stop();
      await runServerPromise(
        serverLog("info", "Graceful shutdown complete. Exiting."),
      );
      process.exit(0);
    };

    process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
    process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
  } else {
    console.error("\n❌ Server setup failed. Details below:\n");
    console.error(Cause.pretty(exit.cause));
    process.exit(1);
  }
});
