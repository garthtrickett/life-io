// lib/server/utils.ts
import { Effect } from "effect";
import { Crypto } from "./crypto";

/**
 * Generates a random, URL-safe string of a given length.
 * This is an Effect that depends on the `Crypto` service.
 *
 * @param length The desired length of the random string.
 * @returns An Effect that resolves to a URL-safe, random string.
 */
export const generateId = (
  length: number,
): Effect.Effect<string, never, Crypto> =>
  Effect.gen(function* () {
    const crypto = yield* Crypto;
    const buffer = yield* crypto.randomBytes(Math.ceil(length / 2));
    return buffer.toString("hex").slice(0, length);
  });
