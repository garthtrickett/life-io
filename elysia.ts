// FILE: ./elysia.ts
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

const setupApp = Effect.gen(function* () {
  const app = yield* makeApp;

  // This is the global error handler for the entire Elysia app.
  app.onError(({ code, error, set }) => {
    // --- START OF DEFINITIVE FIX ---

    // 1. Safely get a descriptive message for logging.
    let logMessage: string;
    if (error instanceof Error) {
      logMessage = error.message;
    } else if (typeof error === "object" && error !== null) {
      // For any other object, stringify it to avoid "[object Object]".
      logMessage = JSON.stringify(error);
    } else {
      // For primitives, String() is safe.
      logMessage = String(error);
    }

    runServerUnscoped(
      serverLog(
        "error",
        `[Elysia onError] Caught a ${code} error: ${logMessage}`,
        undefined,
        "Elysia:GlobalError",
      ),
    );

    // 2. Check if the error is the specific `ApiError` from our `effectHandler`.
    if (
      typeof error === "object" &&
      error !== null &&
      "_tag" in error &&
      (error as { _tag: unknown })._tag === "ApiError"
    ) {
      const apiError = error as { message: string; cause?: unknown };
      let originalErrorTag = "UnknownCause";

      // 3. Safely check the *cause* of the ApiError to find the original error's tag.
      const cause = apiError.cause;
      if (
        typeof cause === "object" &&
        cause !== null &&
        "_tag" in cause &&
        typeof (cause as { _tag: unknown })._tag === "string"
      ) {
        originalErrorTag = (cause as { _tag: string })._tag;
      }

      // 4. Set the HTTP status code based on the original error's tag.
      switch (originalErrorTag) {
        case "AuthError":
          set.status = 401; // Unauthorized
          break;
        case "FileError":
        case "InvalidPullRequestError":
        case "NoteValidationError":
          set.status = 400; // Bad Request
          break;
        case "NoteNotFoundError":
          set.status = 404; // Not Found
          break;
        // All other specific, but internal, errors default to 500.
        case "ReplicachePushError":
        case "NoteDatabaseError":
        default:
          set.status = 500; // Internal Server Error
          break;
      }

      // 5. Return a structured JSON response to the client.
      return {
        error: {
          type: originalErrorTag,
          message: apiError.message, // This is the detailed message we want.
        },
      };
    }

    // 6. If it wasn't an ApiError, it's something else from the framework.
    //    Return a generic 500 response.
    set.status = 500;
    return {
      error: {
        type: "UnknownServerError",
        message: "An unexpected server error occurred.",
      },
    };
    // --- END OF DEFINITIVE FIX ---
  });

  // Request logger
  app.onBeforeHandle(({ request }) => {
    runServerUnscoped(
      serverLog(
        "debug",
        `[SERVER IN] ${request.method} ${new URL(request.url).pathname}`,
        undefined,
        "Elysia:Request",
      ),
    );
  });

  // Scheduled Jobs
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
