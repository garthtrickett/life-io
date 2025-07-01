// lib/server/runtime.ts
import { Effect, Layer } from "effect";
import type { ConfigError } from "effect/ConfigError";
import type { Db } from "../../db/DbTag";
import { DbLayer } from "../../db/DbLayer";
import type { S3 } from "./s3";
import { S3Live } from "./s3";
import { CryptoLive, type Crypto } from "./crypto";
import { ConfigLive } from "./Config";
import { serverLog } from "./logger.server";

// 1. Combine the core service layers.
const ServerServices = Layer.mergeAll(DbLayer, S3Live, CryptoLive);

// 2. This is the "recipe" for building all our services.
//    It now includes robust error handling for configuration issues.
export const ServerLive = ServerServices.pipe(
  Layer.provide(ConfigLive),
  // **FIX:** Catch any ConfigError during layer creation, log it, and treat it as a
  // fatal defect. The application cannot run without valid config.
  Layer.catchAll((error: ConfigError) => {
    Effect.gen(function* () {
      yield* serverLog("info", "no user", "EmailService");
    });
    // End the process by returning a fatal defect.
    return Layer.die(error);
  }),
);

// Define the context type that our server effects will require.
type ServerContext = Db | S3 | Crypto;

/**
 * Executes a server-side Effect and returns a Promise of its result.
 * This function takes an effect that requires services from our application,
 * provides the live implementations via `ServerLive`, and then runs it.
 */
export const runServerPromise = <A, E>(
  effect: Effect.Effect<A, E, ServerContext>,
) => {
  // With the error handled in the ServerLive layer, this type is now correct.
  const providedEffect: Effect.Effect<A, E, never> = Effect.provide(
    effect,
    ServerLive,
  );

  return Effect.runPromise(providedEffect);
};

/**
 * Executes a server-side Effect in a "fire-and-forget" manner.
 * This function takes an effect, provides its required services,
 * and then forks it into the background.
 */
export const runServerUnscoped = <A, E>(
  effect: Effect.Effect<A, E, ServerContext>,
) => {
  // With the error handled in the ServerLive layer, this type is now correct.
  const providedEffect: Effect.Effect<A, E, never> = Effect.provide(
    effect,
    ServerLive,
  );
  return Effect.runFork(providedEffect);
};
