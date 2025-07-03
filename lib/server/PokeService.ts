// lib/server/PokeService.ts
import { Context, Effect, Layer, PubSub, Stream, pipe } from "effect";
import { serverLog } from "./logger.server";

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface PokeService {
  readonly poke: () => Effect.Effect<void>;
  readonly subscribe: () => Stream.Stream<string>;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class PokeService extends Context.Tag("PokeService")<
  PokeService,
  PokeService
>() {}

export const PokeServiceLive = Layer.effect(
  PokeService,
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<string>();

    const poke = () =>
      pipe(
        serverLog("info", "Poking clients...", undefined, "PokeService"),
        Effect.andThen(PubSub.publish(pubsub, "poke")),
        Effect.asVoid,
      );

    const subscribe = () => Stream.fromPubSub(pubsub);

    // This explicit cast helps TypeScript resolve the circular type reference
    // between the class, interface, and its implementation.
    return PokeService.of({ poke, subscribe } as PokeService);
  }),
);
