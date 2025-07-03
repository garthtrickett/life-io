// lib/server/runtime.ts
import { Effect, Layer } from "effect";
import type { ConfigError } from "effect/ConfigError";
import type { Db } from "../../db/DbTag";
import { DbLayer } from "../../db/DbLayer";
import type { S3 } from "./s3";
import { S3Live } from "./s3";
import { CryptoLive, type Crypto } from "./crypto";
import { ConfigLive } from "./Config";
import { PokeService, PokeServiceLive } from "./PokeService";

// 1. Combine the core service layers.
const ServerServices = Layer.mergeAll(
  DbLayer,
  S3Live,
  CryptoLive,
  PokeServiceLive,
);

// 2. This is the "recipe" for building all our services.
//    It now includes robust error handling for configuration issues.
export const ServerLive = ServerServices.pipe(
  Layer.provide(ConfigLive),
  Layer.catchAll((error: ConfigError) => {
    console.error(
      "FATAL: Configuration layer failed to build. Check .env variables.",
      error,
    );
    return Layer.die(error);
  }),
);

// Define the context type that our server effects will require.
export type ServerContext = Db | S3 | Crypto | PokeService;

/**
 * Executes a server-side Effect and returns a Promise of its result.
 * This function takes an effect that requires services from our application,
 * provides the live implementations via `ServerLive`, and then runs it.
 */
export const runServerPromise = <A, E>(
  effect: Effect.Effect<A, E, ServerContext>,
) => {
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
  const providedEffect: Effect.Effect<A, E, never> = Effect.provide(
    effect,
    ServerLive,
  );
  return Effect.runFork(providedEffect);
};
