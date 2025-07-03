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
        Effect.tryPromise(
          () =>
            // --- FIX START ---
            // The configuration is now correctly nested inside the 'options' object.
            logtail({
              sourceToken: process.env.LOGTAIL_SOURCE_TOKEN!,
              options: {
                sendLogsToBetterStack: true,
                endpoint: "https://s1238029.eu-nbg-2.betterstackdata.com",
              },
            }),
          // --- FIX END ---
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
  return pino({ level }, stream);
}).pipe(Effect.tap(() => Console.log("Server Logger created successfully")));

// The effect now has a requirement of LogConfig, so we provide the live layer
// before running it to create the singleton logger promise.
export const loggerPromise = Effect.runPromise(
  Effect.provide(createLoggerEffect, LogConfigLive),
);

export async function getLoggerWithUser(
  userId?: string,
  context?: string,
): Promise<Logger> {
  const logger = await loggerPromise;
  return logger.child({ userId, ...(context ? { context } : {}) });
}

export function serverLog(
  level: "info" | "error" | "warn" | "debug",
  message: string,
  userId?: string,
  context?: string,
): Effect.Effect<void, never, never> {
  return pipe(
    Effect.tryPromise(() => getLoggerWithUser(userId, context)),
    Effect.flatMap((logger: Logger) =>
      Effect.sync(() => logger[level](message)),
    ),
    Effect.catchAll(() => Effect.succeed(undefined)),
  );
}
