// ./lib/server/PokeService.ts
import { Context, Effect, Layer, PubSub, Stream, pipe, Console } from "effect";
import { serverLog } from "./logger.server";

// ... interface and class definition are the same ...
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

// --- START OF FIX: Use Layer.scoped to create a true singleton ---
export const PokeServiceLive = Layer.scoped(
  PokeService,
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<string>();
    // This log runs during runtime construction, so it must be synchronous.
    // The original `serverLog` is async and caused the FiberFailure.
    // We now use the synchronous `Console.log` for this initialization step.
    yield* Console.log(
      "INFO: Singleton PokeService created with new PubSub. [Context: PokeService:Lifecycle]",
    );

    const poke = () =>
      pipe(
        serverLog(
          "info",
          "PokeService.poke() called. Publishing 'poke' message.",
          undefined,
          "PokeService:poke",
        ),
        Effect.andThen(PubSub.publish(pubsub, "poke")),
        Effect.asVoid,
      );

    const subscribe = () =>
      Stream.tap(Stream.fromPubSub(pubsub), () =>
        serverLog(
          "debug",
          "New subscription to PokeService PubSub.",
          undefined,
          "PokeService:subscribe",
        ),
      );

    return PokeService.of({ poke, subscribe } as PokeService);
  }),
);
