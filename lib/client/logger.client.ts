// FILE: lib/client/logger.client.ts
import { Console, Effect, pipe } from "effect";
import type { LogLevel } from "../shared/logConfig";

export type Logger = {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
};

export type LoggableLevel = Exclude<LogLevel, "silent">;

/**
 * This is the single, universal logger for the client-side. It sends all logs
 * to our server's `/log/client` endpoint, regardless of the environment.
 * The server is then responsible for handling them appropriately (console in dev, Logtail in prod).
 */
const createClientLogger = (): Logger => {
  const sendLogToServer = (level: LogLevel, args: unknown[]) => {
    // We use `navigator.sendBeacon` if available for a more reliable, non-blocking
    // way to send logs, especially when the user is navigating away.
    // Fallback to fetch for older browsers.
    const url = "/log/client";
    const data = JSON.stringify({ level, args });

    try {
      if (navigator.sendBeacon) {
        // --- FIX START: Convert the string to a Blob to set the correct Content-Type ---
        const blob = new Blob([data], { type: "application/json" });
        navigator.sendBeacon(url, blob); // --- FIX END ---
      } else {
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: data,
          keepalive: true, // Important for requests during page unload
        });
      }
    } catch (error) {
      console.error("Failed to send log to server:", error);
    }
  };

  return {
    info: (...args) => {
      console.info(...args);
      sendLogToServer("info", args);
    },
    error: (...args) => {
      console.error(...args);
      sendLogToServer("error", args);
    },
    warn: (...args) => {
      console.warn(...args);
      sendLogToServer("warn", args);
    },
    debug: (...args) => {
      console.debug(...args);
      sendLogToServer("debug", args);
    },
  };
};

// This effect now simply creates our universal client logger.
const createClientLoggerEffect = Effect.sync(() => {
  Console.log(
    "Client logger created. All logs will be sent to the server endpoint.",
  );
  return createClientLogger();
});

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
