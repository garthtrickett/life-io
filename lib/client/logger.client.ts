import { Console, Effect, pipe } from "effect";
import type { LogLevel } from "../shared/logConfig";

export type Logger = {
  info: (...args: any[]) => void;
  error: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  debug: (...args: any[]) => void;
};

export type LoggableLevel = Exclude<LogLevel, "silent">;

// --- This is our new Development Logger ---
const createDevelopmentLogger = (): Logger => {
  const sendLogToServer = (level: LogLevel, args: any[]) => {
    fetch("/log/client", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level, args }),
    }).catch(console.error);
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

// --- This is our Production Logger ---
const createProductionLogger = (token: string): Effect.Effect<Logger, Error> =>
  Effect.gen(function* () {
    const { Browser } = yield* Effect.tryPromise(() => import("@logtail/js"));
    const logtail = new Browser(token);
    yield* Console.log(
      "Client logger (Logtail) created successfully for production.",
    );
    return {
      info: logtail.info.bind(logtail),
      error: logtail.error.bind(logtail),
      warn: logtail.warn.bind(logtail),
      debug: logtail.debug.bind(logtail),
    };
  });

// --- This is the main Effect that decides which logger to create ---
const createClientLoggerEffect = Effect.gen(function* () {
  if (import.meta.env.DEV) {
    yield* Console.log(
      "Client logger running in DEV mode (logging to console and server).",
    );
    return createDevelopmentLogger();
  }

  const token = import.meta.env.VITE_LOGTAIL_SOURCE_TOKEN;
  if (!token) {
    yield* Console.warn(
      "VITE_LOGTAIL_SOURCE_TOKEN not set for production build! Falling back to console logging.",
    );
    return createDevelopmentLogger();
  }

  return yield* createProductionLogger(token);
});

export const clientLoggerPromise: Promise<Logger> = Effect.runPromise(
  createClientLoggerEffect,
);

export async function getClientLoggerWithUser(
  userId: string,
  context?: string,
): Promise<Logger> {
  const logger = await clientLoggerPromise;
  const prefix = `[user: ${userId}]${context ? ` [context: ${context}]` : ""}`;
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
  userId: string,
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
