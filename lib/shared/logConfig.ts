import { Context, Effect, Layer, Ref } from "effect";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

/**
 * The interface for our logging configuration service.
 * It holds the current log level in a Ref, allowing for safe, concurrent updates.
 */
export interface ILogConfig {
  readonly logLevel: Ref.Ref<LogLevel>;
}

/**
 * The service Tag for LogConfig. This is used to add and retrieve the service
 * from the Context.
 */
export class LogConfig extends Context.Tag("LogConfig")<
  LogConfig,
  ILogConfig
>() {}

/**
 * The live implementation of the LogConfig service. It creates a Ref
 * with a default log level of "info".
 */
export const LogConfigLive = Layer.effect(
  LogConfig,
  Effect.map(Ref.make<LogLevel>("info"), (logLevel) => ({ logLevel })),
);

/**
 * An Effect to set the global log level. It requires the LogConfig service.
 */
export const setGlobalLogLevel = (
  level: LogLevel,
): Effect.Effect<void, never, LogConfig> =>
  Effect.flatMap(LogConfig, (service) => Ref.set(service.logLevel, level));

/**
 * An Effect to get the current global log level. It requires the LogConfig service.
 */
export const getGlobalLogLevel = (): Effect.Effect<
  LogLevel,
  never,
  LogConfig
> => Effect.flatMap(LogConfig, (service) => Ref.get(service.logLevel));

/**
 * Returns the effective log level for a given user as an Effect.
 * It checks for environment variable overrides before consulting the global log level from the LogConfig service.
 */
export function getEffectiveLogLevel(
  userId?: string,
): Effect.Effect<LogLevel, never, LogConfig> {
  return Effect.gen(function* () {
    const overrideLevel = process.env.LOG_LEVEL_OVERRIDE as
      | LogLevel
      | undefined;
    const overrideUser = process.env.LOG_USER;

    // 1. Prioritize user-specific debug sessions
    if (userId && overrideUser === userId && overrideLevel) {
      return overrideLevel;
    }

    // 2. Fall back to the global override if it's set
    if (overrideLevel) {
      return overrideLevel;
    }

    // 3. Use the default global log level from our service
    return yield* getGlobalLogLevel();
  });
}

// A numeric ranking so we can compare levels
export const levelRank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
};
