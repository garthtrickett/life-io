// lib/server/utils.ts
import { Effect } from "effect";
import { Crypto } from "./crypto";
import { randomUUID } from "node:crypto";

/**
 * Generates a standard v4 UUID string.
 * This is a synchronous Effect and does not require the Crypto service.
 * @returns An Effect that resolves to a UUID string (e.g., "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx").
 */
export const generateUUID = (): Effect.Effect<string> =>
  Effect.sync(() => randomUUID());

/**
 * Generates a random, URL-safe string of a given length.
 * This is an Effect that depends on the `Crypto` service.
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
