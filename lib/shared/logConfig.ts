export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

let globalLogLevel: LogLevel = "info";

export function setGlobalLogLevel(level: LogLevel): void {
  globalLogLevel = level;
}

export function getGlobalLogLevel(): LogLevel {
  return globalLogLevel;
}

/**
 * Returns the effective log level for a given user.
 * If process.env.LOG_USER matches the provided userId and a
 * process.env.LOG_LEVEL_OVERRIDE is set, that override level is returned.
 */
export function getEffectiveLogLevel(userId?: string): LogLevel {
  // For server-side, Bun automatically loads .env. For client, this will be handled by the build tool.
  const overrideUser = process.env.LOG_USER;
  const overrideLevel = process.env.LOG_LEVEL_OVERRIDE;

  if (userId && overrideUser === userId && overrideLevel) {
    return overrideLevel as LogLevel;
  }
  return globalLogLevel;
}

// A numeric ranking so we can compare levels
export const levelRank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
};
