// FILE: /home/user/files/code/life-io/lib/client/trpc/tryTrpc.ts

import { Data, Effect } from "effect";

/**
 * A generic error for when a tRPC call fails for an unknown reason or
 * a reason not covered by the provided error map.
 */
export class UnknownTrpcError extends Data.TaggedError("UnknownTrpcError")<{
  readonly cause: unknown;
}> {}

/**
 * Defines the shape of the map that translates tRPC error codes to our custom tagged errors.
 * e.g., { 'UNAUTHORIZED': () => new MyUnauthorizedError() }
 */
type ErrorMap<E> = {
  [key: string]: () => E;
};

/**
 * Wraps a tRPC procedure promise in an Effect, providing a structured way
 * to handle specific tRPC errors by mapping them to tagged errors.
 *
 * @param promiseFn A function that returns the tRPC promise to execute.
 * @param errorMap An object mapping tRPC error codes (e.g., 'UNAUTHORIZED') to functions that create tagged errors.
 * @returns An Effect that will either succeed with the tRPC result or fail with a mapped tagged error or a generic `UnknownTrpcError`.
 */
export const tryTrpc = <A, E>(
  promiseFn: () => Promise<A>,
  errorMap: ErrorMap<E>,
): Effect.Effect<A, E | UnknownTrpcError> => {
  return Effect.tryPromise({
    try: promiseFn,
    catch: (err: unknown): E | UnknownTrpcError => {
      if (
        typeof err === "object" &&
        err !== null &&
        "data" in err &&
        typeof (err.data as { code?: string }).code === "string"
      ) {
        const code = (err.data as { code: string }).code;
        const handler = errorMap[code];
        if (handler) {
          return handler();
        }
      }
      return new UnknownTrpcError({ cause: err });
    },
  });
};
