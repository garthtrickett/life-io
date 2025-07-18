// FILE: ./elysia.ts
import { Cause, Effect, Schedule, Duration, pipe } from "effect";
import { makeApp } from "./elysia/routes";
import {
  runServerPromise,
  runServerUnscoped,
  shutdownServer,
} from "./lib/server/runtime";
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
      // For any other type, stringify it safely.
      descriptiveMessage = JSON.stringify(error, null, 2);
    }

    void runServerUnscoped(
      serverLog(
        "error", // level
        { code, error }, // data
        `[Elysia onError] Caught error: ${descriptiveMessage}`, // message
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
        typeof (cause as { _tag: string })._tag === "string"
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

    if (typeof error === "object" && error !== null) {
      if (
        "code" in error &&
        typeof (error as { code: unknown }).code === "string"
      ) {
        const errorCode = (error as { code: string }).code;
        switch (errorCode) {
          case "UNAUTHORIZED":
            set.status = 401;
            break;
          case "FORBIDDEN":
            set.status = 403;
            break;
          case "NOT_FOUND":
            set.status = 404;
            break;
          case "CONFLICT":
            set.status = 409;
            break;
          case "BAD_REQUEST":
            set.status = 400;
            break;
          default:
            set.status = 500;
            break;
        }
        return {
          error: {
            type: errorCode,
            message: descriptiveMessage,
          },
        };
      }
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
        "debug", // level
        { method: request.method, path: new URL(request.url).pathname }, // data
        "Server Request IN", // message
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
          "error", // level
          { error: e }, // data
          `Token cleanup job failed: ${e.message}`, // message
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
          "error", // level
          { error: e }, // data
          `Email retry job failed: ${e.message}`, // message
          "Job:EmailRetry",
        ),
      ),
    ),
  );

  return app;
});

// --- Application Entry Point ---
runServerPromise(setupApp)
  .then((app) => {
    const server = app.listen(42069, () => {
      void runServerUnscoped(
        serverLog(
          "info", // level
          { port: 42069 }, // data
          "🦊 Elysia server with tRPC listening", // message
          "Startup",
        ),
      );
    });

    const gracefulShutdown = async (signal: string) => {
      await runServerPromise(
        serverLog(
          "info", // level
          { signal }, // data
          "Received signal. Shutting down gracefully...", // message
          "Shutdown",
        ),
      );
      await server.stop();
      await shutdownServer();
      console.warn("Graceful shutdown complete. Exiting.");
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
