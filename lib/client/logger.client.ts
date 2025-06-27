import type { Browser as Logtail } from "@logtail/js";
import { Effect, pipe } from "effect";
import { getEffectiveLogLevel, levelRank } from "../shared/logConfig";

export type Logger = {
  info: (...args: any[]) => void;
  error: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  debug: (...args: any[]) => void;
};

const shouldLog = (
  messageLevel: keyof typeof levelRank,
  userId?: string,
): boolean =>
  levelRank[messageLevel] >= levelRank[getEffectiveLogLevel(userId)];

const adaptLogtail = (lt: Logtail, userId?: string): Logger => ({
  info: (...args: Parameters<Logtail["info"]>) => {
    if (shouldLog("info", userId)) lt.info(...args);
  },
  error: (...args: Parameters<Logtail["error"]>) => {
    if (shouldLog("error", userId)) lt.error(...args);
  },
  warn: (...args: Parameters<Logtail["warn"]>) => {
    if (shouldLog("warn", userId)) lt.warn(...args);
  },
  debug: (...args: Parameters<Logtail["debug"]>) => {
    if (shouldLog("debug", userId)) lt.debug(...args);
  },
});

const createClientLoggerEffect = pipe(
  // Use the Vite/frontend environment variable for the token
  Effect.tryPromise(() =>
    import("@logtail/js").then(
      ({ Browser }) => new Browser(import.meta.env.VITE_LOGTAIL_SOURCE_TOKEN!),
    ),
  ),
  Effect.map((lt) => adaptLogtail(lt)),
  Effect.tap(() => console.log("Client logger created successfully")),
);

export const clientLoggerPromise: Promise<Logger> = Effect.runPromise(
  createClientLoggerEffect,
) as Promise<Logger>;

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

/**
 * Generic client logging helper that returns an Effect which logs the given message.
 */
export function clientLog(
  level: "info" | "error" | "warn" | "debug",
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
