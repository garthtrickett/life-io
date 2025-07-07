// FILE: lib/server/runtime.ts
import { Effect, Layer, Runtime, Scope, Exit } from "effect";
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

// 2. Define the full application layer.
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

// --- START OF DEFINITIVE FIX ---

// 3. Create a single scope for the application's entire lifecycle.
const appScope = Effect.runSync(Scope.make());

// 4. Build the layer within that scope to create the singleton runtime.
const AppRuntime = Effect.runSync(
  Scope.extend(Layer.toRuntime(ServerLive), appScope),
);

/**
 * The singleton runtime containing all live services for the application.
 */
export const serverRuntime = AppRuntime;

/**
 * Executes a server-side Effect and returns a Promise, using the shared singleton runtime.
 */
export const runServerPromise = <A, E>(
  effect: Effect.Effect<A, E, ServerContext>,
) => Runtime.runPromise(serverRuntime)(effect);

/**
 * Executes a server-side Effect in a "fire-and-forget" manner, using the shared singleton runtime.
 */
export const runServerUnscoped = <A, E>(
  effect: Effect.Effect<A, E, ServerContext>,
) => Runtime.runFork(serverRuntime)(effect);

/**
 * A dedicated function to gracefully shut down the application's runtime.
 * It closes the application's scope, which releases all resources (like DB connections and PubSub).
 * The exit type is corrected to use `Exit.succeed(undefined)`.
 */
export const shutdownServer = () =>
  Effect.runPromise(Scope.close(appScope, Exit.succeed(undefined)));

// --- END OF DEFINITIVE FIX ---
