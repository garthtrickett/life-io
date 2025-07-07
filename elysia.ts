// FILE: ./elysia.ts
import { Cause, Effect, Schedule, Duration, pipe } from "effect";
import { makeApp } from "./elysia/routes";
// --- START OF DEFINITIVE FIX: Use the singleton runtime for the main app startup ---
import {
  runServerPromise,
  runServerUnscoped,
  shutdownServer,
} from "./lib/server/runtime";
// --- END OF DEFINITIVE FIX ---
import { serverLog } from "./lib/server/logger.server";
import {
  cleanupExpiredTokensEffect,
  retryFailedEmailsEffect,
} from "./lib/server/jobs";

const setupApp = Effect.gen(function* () {
  const app = yield* makeApp;

  app.onError(({ code, error, set }) => {
    let descriptiveMessage: string;
    if (error instanceof Error) {
      descriptiveMessage = error.message;
    } else if (
      typeof error === "object" &&
      error !== null &&
      "message" in error
    ) {
      descriptiveMessage = String((error as { message: unknown }).message);
    } else {
      descriptiveMessage = String(error);
    }

    void runServerUnscoped(
      serverLog(
        "error",
        `[Elysia onError] Caught a ${code} error: ${JSON.stringify(
          error,
          null,
          2,
        )}`,
        undefined,
        "Elysia:GlobalError",
      ),
    );

    if (
      typeof error === "object" &&
      error !== null &&
      "_tag" in error &&
      (error as { _tag: unknown })._tag === "ApiError"
    ) {
      const apiError = error as { message: string; cause?: unknown };
      let originalErrorTag = "UnknownCause";

      const cause = apiError.cause;
      if (
        typeof cause === "object" &&
        cause !== null &&
        "_tag" in cause &&
        typeof (cause as { _tag: unknown })._tag === "string"
      ) {
        originalErrorTag = (cause as { _tag: string })._tag;
      }

      switch (originalErrorTag) {
        case "AuthError":
          set.status = 401;
          break;
        case "FileError":
        case "InvalidPullRequestError":
        case "NoteValidationError":
          set.status = 400;
          break;
        case "NoteNotFoundError":
          set.status = 404;
          break;
        default:
          set.status = 500;
          break;
      }

      return {
        error: {
          type: originalErrorTag,
          message: apiError.message,
        },
      };
    }

    set.status = 500;
    return {
      error: {
        type: "UnknownServerError",
        message: descriptiveMessage,
      },
    };
  });

  app.onBeforeHandle(({ request }) => {
    void runServerUnscoped(
      serverLog(
        "debug",
        `[SERVER IN] ${request.method} ${new URL(request.url).pathname}`,
        undefined,
        "Elysia:Request",
      ),
    );
  });

  // Scheduled Jobs
  void runServerUnscoped(
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

  void runServerUnscoped(
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
// --- START OF DEFINITIVE FIX: The main program is now run with our singleton runtime ---
// We no longer use Effect.provide here, as the runtime handles it.
// `runServerPromise` returns a native Promise, simplifying the .then/.catch chain.
runServerPromise(setupApp)
  .then((app) => {
    const server = app.listen(42069, () => {
      void runServerUnscoped(
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
      // This will now properly release all resources (DB connections, PubSub, etc.)
      await shutdownServer();
      console.log("Graceful shutdown complete. Exiting.");
      process.exit(0);
    };

    process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
    process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
  })
  .catch((err) => {
    console.error("\n❌ Server setup failed. Details below:\n");
    const cause = Cause.isCause(err) ? err : Cause.die(err);
    console.error(Cause.pretty(cause));
    process.exit(1);
  });
// --- END OF DEFINITIVE FIX ---
