import logtail from "@logtail/pino";
import { Console, Effect, pipe } from "effect";
import type { DestinationStream, Logger } from "pino";
import pino from "pino";
import pretty from "pino-pretty";
import {
  getEffectiveLogLevel,
  LogConfigLive,
} from "../../lib/shared/logConfig";

const createLoggerEffect = Effect.gen(function* () {
  const env = process.env.NODE_ENV ?? "development";
  const stream: DestinationStream = yield* env === "production"
    ? pipe(
        Effect.tryPromise(() =>
          logtail({
            sourceToken: process.env.LOGTAIL_SOURCE_TOKEN!,
            options: {
              sendLogsToBetterStack: true,
              endpoint: "https://s1238029.eu-nbg-2.betterstackdata.com",
            },
          }),
        ),
        Effect.map(
          (ltStream) =>
            pino.multistream([
              ltStream,
              { stream: pretty() },
            ]) as DestinationStream,
        ),
      )
    : Effect.succeed(pretty({ colorize: true }) as DestinationStream);

  const level = yield* getEffectiveLogLevel();

  // Define redaction rules. This will automatically censor sensitive data
  // in log objects before they are written.
  const pinoOptions = {
    level,
    redact: {
      paths: [
        "user.id",
        "user.email",
        "user.password_hash",
        "userId",
        "email",
        "clientGroupID",
        "ip",
        "session.id",
        "sessionId",
        "*.password_hash", // Redact password hash wherever it appears
      ],
      censor: "[REDACTED]",
    },
  };

  return pino(pinoOptions, stream);
}).pipe(Effect.tap(() => Console.log("Server Logger created successfully")));

export const loggerPromise = Effect.runPromise(
  Effect.provide(createLoggerEffect, LogConfigLive),
);

// Now it accepts a data object to be included in the log.
export async function getLoggerWithContext(
  data: object,
  context?: string,
): Promise<Logger> {
  const logger = await loggerPromise;
  return logger.child({ ...data, ...(context ? { context } : {}) });
}

// The new signature puts the structured data first.
export function serverLog(
  level: "info" | "error" | "warn" | "debug",
  data: object, // Structured data for logging and redaction
  message: string,
  context?: string,
): Effect.Effect<void, never, never> {
  return pipe(
    Effect.tryPromise(() => getLoggerWithContext(data, context)),
    Effect.flatMap((logger: Logger) =>
      Effect.sync(() => logger[level](message)),
    ),
    Effect.catchAll(() => Effect.succeed(undefined)),
  );
}
