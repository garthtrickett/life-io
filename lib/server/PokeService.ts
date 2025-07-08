// FILE: lib/server/PokeService.ts

import { Context, Effect, Layer, PubSub, Stream, Console, Ref } from "effect";
import { serverLog } from "./logger.server";
import type { UserId } from "../../types/generated/public/User";

/**
 * The service definition and Tag remain unchanged.
 * We've added the method signatures to the second generic parameter
 * to make the service's "shape" clear.
 */
export class PokeService extends Context.Tag("PokeService")<
  PokeService,
  {
    readonly poke: (userId: UserId) => Effect.Effect<void>;
    readonly subscribe: (userId: UserId) => Stream.Stream<string>;
  }
>() {}

/**
 * The live implementation of the PokeService.
 */
export const PokeServiceLive = Layer.scoped(
  PokeService,
  Effect.gen(function* () {
    // This stateful part is the same
    const userPubSubs = yield* Ref.make(
      new Map<UserId, PubSub.PubSub<string>>(),
    );

    yield* Console.log(
      "INFO: Singleton PokeService created. [Context: PokeService:Lifecycle]",
    );

    // The implementation logic is also the same
    const poke = (userId: UserId) =>
      Effect.gen(function* () {
        yield* serverLog(
          "info",
          `PokeService.poke() called for user ${userId}.`,
          userId,
          "PokeService:poke",
        );
        const pubSubsMap = yield* Ref.get(userPubSubs);
        const userPubSub = pubSubsMap.get(userId);

        if (userPubSub) {
          yield* PubSub.publish(userPubSub, "poke");
        } else {
          yield* serverLog(
            "debug",
            `No active poke subscriptions for user ${userId}. Poke ignored.`,
            userId,
            "PokeService:poke",
          );
        }
      });

    const subscribe = (userId: UserId) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const pubSubsMap = yield* Ref.get(userPubSubs);
          let userPubSub = pubSubsMap.get(userId);

          if (!userPubSub) {
            yield* serverLog(
              "debug",
              `Creating new PubSub for user: ${userId}`,
              userId,
              "PokeService:subscribe",
            );
            userPubSub = yield* PubSub.unbounded<string>();
            yield* Ref.update(userPubSubs, (map) =>
              map.set(userId, userPubSub!),
            );
          }

          return Stream.fromPubSub(userPubSub).pipe(
            Stream.ensuring(
              Effect.gen(function* () {
                const currentPubSub = (yield* Ref.get(userPubSubs)).get(userId);
                if (
                  currentPubSub &&
                  (yield* PubSub.size(currentPubSub)) === 0
                ) {
                  yield* serverLog(
                    "debug",
                    `All subscriptions closed for user ${userId}. Removing PubSub.`,
                    userId,
                    "PokeService:unsubscribe",
                  );
                  yield* Ref.update(userPubSubs, (map) => {
                    map.delete(userId);
                    return map;
                  });
                }
              }),
            ),
          );
        }),
      );

    // ⬇️ THE FIX ⬇️
    // Create an object that inherits from PokeService.prototype,
    // making it a valid 'instance' of PokeService for TypeScript.
    // Then, assign our implemented methods to it.
    return Object.assign(Object.create(PokeService.prototype), {
      poke,
      subscribe,
    });
  }),
);
