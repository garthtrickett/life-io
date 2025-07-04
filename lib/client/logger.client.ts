// FILE: lib/client/logger.client.ts
// --- Full content with the added debugging line ---

import { Console, Data, Effect, pipe, Schedule } from "effect";
import type { LogLevel } from "../shared/logConfig";
import { runClientUnscoped } from "./runtime";

export type Logger = {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
};

export type LoggableLevel = Exclude<LogLevel, "silent">;

/**
 * A typed error for when sending logs to the server fails.
 */
class SendLogError extends Data.TaggedError("SendLogError")<{
  readonly cause: unknown;
}> {}

/**
 * An Effect-based function to send a log entry to the server.
 * It prefers `sendBeacon` for its non-blocking nature and falls back to `fetch`
 * with a retry mechanism for increased reliability.
 */
const sendLogToServer = (
  level: LogLevel,
  args: unknown[],
): Effect.Effect<void, SendLogError> => {
  const url = "/api/log/client";
  const data = JSON.stringify({ level, args });

  // Use sendBeacon if available, as it's non-blocking for page unloads.
  if (navigator.sendBeacon) {
    return Effect.sync(() => {
      const blob = new Blob([data], { type: "application/json" });
      if (!navigator.sendBeacon(url, blob)) {
        throw new Error("sendBeacon returned false, data was not queued.");
      }
    }).pipe(Effect.mapError((cause) => new SendLogError({ cause })));
  }

  const baseRetrySchedule = Schedule.exponential("100 millis").pipe(
    Schedule.jittered,
    Schedule.compose(Schedule.recurs(3)),
  );

  const loggingRetrySchedule = baseRetrySchedule.pipe(
    Schedule.onDecision(() =>
      Console.warn(`Log transmission failed. Retrying...`),
    ),
  );

  return Effect.tryPromise({
    try: () =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: data,
        keepalive: true,
      }),
    catch: (cause) => new SendLogError({ cause }),
  }).pipe(
    // --- START OF FIX ---
    // This new line will log any network or proxy error from the fetch call itself,
    // which is crucial for debugging the Vite proxy.
    Effect.tapError((e) =>
      Console.error(
        `[CRITICAL] sendLogToServer fetch failed: ${String(e.cause)}`,
      ),
    ),
    // --- END OF FIX ---
    Effect.flatMap((response) =>
      response.ok
        ? Effect.void
        : Effect.fail(
            new SendLogError({
              cause: `Server responded with status ${response.status}`,
            }),
          ),
    ),
    Effect.retry(loggingRetrySchedule),
  );
};

const createClientLogger = (): Logger => {
  return {
    info: (...args) => {
      console.info(...args);
      runClientUnscoped(sendLogToServer("info", args));
    },
    error: (...args) => {
      console.error(...args);
      runClientUnscoped(sendLogToServer("error", args));
    },
    warn: (...args) => {
      console.warn(...args);
      runClientUnscoped(sendLogToServer("warn", args));
    },
    debug: (...args) => {
      console.debug(...args);
      runClientUnscoped(sendLogToServer("debug", args));
    },
  };
};

const createClientLoggerEffect = pipe(
  Console.log(
    "Client logger created. All logs will be sent to the server endpoint.",
  ),
  Effect.map(() => createClientLogger()),
);

export const clientLoggerPromise: Promise<Logger> = Effect.runPromise(
  createClientLoggerEffect,
);

export async function getClientLoggerWithUser(
  userId?: string,
  context?: string,
): Promise<Logger> {
  const logger = await clientLoggerPromise;

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
