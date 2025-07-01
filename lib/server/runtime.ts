// lib/server/runtime.ts
import { Effect, Layer } from "effect";
import type { Db } from "../../db/DbTag";
import { DbLayer } from "../../db/DbLayer";
import type { S3 } from "./s3";
import { S3Live } from "./s3";
import { CryptoLive, type Crypto } from "./crypto";

// 1. Combine all live service layers for the server into a single Layer.
//    This is the "recipe" for building all our services.
const ServerLive = Layer.mergeAll(DbLayer, S3Live, CryptoLive);

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
  // The 'effect' requires services (Db, S3). We provide the 'ServerLive'
  // layer to satisfy these requirements, including our new Crypto service.
  const providedEffect: Effect.Effect<A, E, never> = Effect.provide(
    effect,
    ServerLive,
  );
  // The resulting effect has no more requirements (R = never), so we can
  // run it with the default runtime's `runPromise`.
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
