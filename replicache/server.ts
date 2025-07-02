// replicache/server.ts
import { Effect } from "effect";
import { Db } from "../db/DbTag";
import type { PushRequest } from "replicache";
import { serverLog } from "../lib/server/logger.server";
import type { UserId } from "../types/generated/public/User";
import type { Block } from "../types/generated/public/Block";

// Define a specific type for the pull response payload
interface PullResponse {
  lastMutationID: number;
  cookie: number;
  patch: {
    op: "put";
    key: string;
    value: Block;
  }[];
}

// Use the new PullResponse type instead of `any`
export const handlePull = (
  userId: UserId,
): Effect.Effect<PullResponse, Error, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;
    yield* serverLog(
      "info",
      `Processing pull for user: ${userId}`,
      userId,
      "Replicache:Pull",
    );

    const blocks = yield* Effect.tryPromise({
      try: () =>
        db
          .selectFrom("block")
          .where("user_id", "=", userId)
          .selectAll()
          .execute(),
      catch: (e) => new Error(String(e)),
    });

    const patch = blocks.map((block) => ({
      // FIX: Use 'as const' to infer the literal type "put" instead of string.
      op: "put" as const,
      key: `block/${block.id}`,
      value: block,
    }));

    // In a real implementation, you would use `pull.cookie` to get changes
    // since the last sync and calculate a new cookie.
    return {
      lastMutationID: 0,
      cookie: 1,
      patch,
    };
  });

// A simplified push handler
export const handlePush = (
  req: PushRequest,
  userId: UserId,
): Effect.Effect<void, Error, Db> =>
  Effect.gen(function* () {
    yield* serverLog(
      "info",
      `Processing push for user: ${userId}`,
      userId,
      "Replicache:Push",
    );

    for (const mutation of req.mutations) {
      yield* serverLog(
        "debug",
        `  Mutation: ${mutation.name}`,

        userId,
        "Replicache:Push",
      );
    }

    // This is a placeholder for the real poke mechanism
    yield* pokeClients();
  });

export const pokeClients = () =>
  serverLog("info", "Poking clients...", undefined, "Replicache:Poke");
