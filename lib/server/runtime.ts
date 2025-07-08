// FILE: lib/server/runtime.ts
import { Effect, Layer, Runtime, Scope, Exit, Cause } from "effect";
import type { ConfigError } from "effect/ConfigError";
import type { Db } from "../../db/DbTag";
import { DbLayer } from "../../db/DbLayer";
import type { S3 } from "./s3";
import { S3Live } from "./s3";
import { CryptoLive, type Crypto } from "./crypto";
import { ConfigLive } from "./Config";
import { PokeService, PokeServiceLive } from "./PokeService";
import { TRPCError } from "@trpc/server";

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

// --- Runtime Setup ---

const appScope = Effect.runSync(Scope.make());
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
 */
export const shutdownServer = () =>
  Effect.runPromise(Scope.close(appScope, Exit.succeed(undefined)));

/**
 * A dedicated runner for tRPC procedures that correctly handles Effect's
 * `FiberFailure` and maps domain errors to `TRPCError`s.
 */
export const handleTrpcProcedure = async <A, E>(
  effect: Effect.Effect<A, E, ServerContext>,
): Promise<A> => {
  const exit = await Runtime.runPromiseExit(serverRuntime)(effect);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }

  // `Cause.squash` finds the "most important" error, prioritizing a typed
  // failure (from Effect.fail) over a defect (from a thrown error).
  const error = Cause.squash(exit.cause);

  const tag = (error as { _tag?: string })?._tag;
  switch (tag) {
    case "InvalidCredentialsError":
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Incorrect email or password.",
        cause: error,
      });
    case "EmailNotVerifiedError":
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Please verify your email address before logging in.",
        cause: error,
      });
    case "EmailInUseError":
      throw new TRPCError({
        code: "CONFLICT",
        message: "An account with this email already exists.",
        cause: error,
      });
    case "TokenInvalidError":
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Token is invalid or has expired.",
        cause: error,
      });
    case "PasswordHashingError":
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Could not process password.",
        cause: error,
      });
    case "AuthDatabaseError":
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "A database error occurred during authentication.",
        cause: error,
      });
    case "TokenCreationError":
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Could not create a required token.",
        cause: error,
      });
    case "EmailSendError":
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "There was a problem sending an email.",
        cause: error,
      });
    default:
      // For any other unexpected errors.
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred.",
        cause: exit.cause, // Log the entire cause for unknown errors
      });
  }
};
