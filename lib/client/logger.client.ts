// FILE: lib/client/logger.client.ts
import { Console, Effect, pipe, Schedule } from "effect";
import type { LogLevel } from "../shared/logConfig";
import { runClientUnscoped } from "./runtime";
import { trpc } from "./trpc";

export type Logger = {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
};

export type LoggableLevel = Exclude<LogLevel, "silent">;

/**
 * An Effect-based function to send a log entry to the server via tRPC.
 * It includes a retry mechanism for increased reliability.
 */
const sendLogToServer = (
  level: LoggableLevel,
  args: unknown[],
): Effect.Effect<void, Error> => {
  // A retry schedule with exponential backoff and jitter.
  const retrySchedule = Schedule.exponential("200 millis").pipe(
    Schedule.jittered,
    Schedule.compose(Schedule.recurs(3)), // Retry up to 3 times
  );

  return pipe(
    Effect.tryPromise({
      try: () => trpc.log.log.mutate({ level, args }),
      catch: (cause) => new Error(String(cause)),
    }),
    Effect.retry(retrySchedule),
  );
};

const createClientLogger = (): Logger => {
  const logWithRemote = (level: LoggableLevel, ...args: unknown[]) => {
    // Only log to the local console if silent mode is NOT enabled.
    if (import.meta.env.VITE_SILENT_CLIENT_LOGGING !== "true") {
      console[level](...args); // This line is now conditional
    }

    // Fire-and-forget the server-side logging (this always runs)
    runClientUnscoped(
      sendLogToServer(level, args).pipe(
        Effect.catchAll((e) =>
          Effect.sync(() =>
            console.error(
              `[CRITICAL] Log transmission failed permanently: ${e.message}`,
            ),
          ),
        ),
      ),
    );
  };

  return {
    info: (...args) => logWithRemote("info", ...args),
    error: (...args) => logWithRemote("error", ...args),
    warn: (...args) => logWithRemote("warn", ...args),
    debug: (...args) => logWithRemote("debug", ...args),
  };
};

const createClientLoggerEffect = pipe(
  Console.warn(
    "Client logger created. All logs will be sent to the server via tRPC.",
  ),
  Effect.map(() => createClientLogger()),
);

export const loggerPromise: Promise<Logger> = Effect.runPromise(
  createClientLoggerEffect,
);

export async function getClientLoggerWithUser(
  userId?: string,
  context?: string,
): Promise<Logger> {
  const logger = await loggerPromise;

  const parts: string[] = [];
  if (userId) parts.push(`[user: ${userId}]`);
  if (context) parts.push(`[context: ${context}]`);
  const prefix = parts.join(" ");

  if (!prefix) {
    return logger;
  }

  return {
    info: (...args) => logger.info(prefix, ...args),
    error: (...args) => logger.error(prefix, ...args),
    warn: (...args) => logger.warn(prefix, ...args),
    debug: (...args) => logger.debug(prefix, ...args),
  };
}

export function clientLog(
  level: LoggableLevel,
  message: string,
  userId?: string,
  context?: string,
): Effect.Effect<void, never, never> {
  return pipe(
    Effect.tryPromise(() => getClientLoggerWithUser(userId, context)),
    Effect.flatMap((logger: Logger) =>
      Effect.sync(() => logger[level](message)),
    ),
    Effect.catchAll(() => Effect.succeed(undefined)),
  );
}
