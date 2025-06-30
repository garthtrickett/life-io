import { randomBytes } from "node:crypto";

/**
 * Generates a random, URL-safe string of a given length.
 * This serves as a project-local equivalent to utilities from libraries
 * like Lucia or Oslo.
 *
 * @param length The desired length of the random string.
 * @returns A URL-safe, random string.
 */
export function generateId(length: number): string {
  // Each byte of random data is represented by 2 hexadecimal characters.
  // To get a string of a desired length, we need half that number of bytes.
  // Math.ceil ensures we generate enough bytes, and slice takes the exact length.
  const buffer = randomBytes(Math.ceil(length / 2));
  return buffer.toString("hex").slice(0, length);
}
