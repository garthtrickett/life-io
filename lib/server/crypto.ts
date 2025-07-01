// lib/server/crypto.ts
import { randomBytes } from "node:crypto";
import { Context, Effect, Layer } from "effect";

// 1. Define the service interface. This is the "shape" of our service.
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface Crypto {
  readonly randomBytes: (length: number) => Effect.Effect<Buffer, never, never>;
}

// 2. Create the Tag using the class-based pattern. This is both the Tag
//    and the service type.
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class Crypto extends Context.Tag("Crypto")<Crypto, Crypto>() {}

// 3. Create the live Layer.
export const CryptoLive = Layer.succeed(
  Crypto,
  // This is the key fix:
  // We use `Crypto.of` to create an instance of our Tag class.
  // We explicitly type the implementation object as `Crypto` to tell
  // TypeScript that this object satisfies the interface, breaking the
  // circular type inference issue that was causing the previous errors.
  Crypto.of({
    randomBytes: (length: number) => Effect.sync(() => randomBytes(length)),
  } as Crypto),
);
