// lib/client/replicache/index.ts
import { Replicache } from "replicache";
import { Effect } from "effect";
import { clientLog } from "../logger.client";
import { toError } from "../../shared/toError";
import { mutators } from "./mutators";
import type { Mutators } from "./types";
import { setupWebSocket } from "./websocket";

export let rep: Replicache<Mutators> | null = null;

export const nullifyReplicache = (): Effect.Effect<void> =>
  Effect.sync(() => {
    rep = null;
  });

export const initReplicache = (
  userId: string,
): Effect.Effect<Replicache<Mutators>> =>
  Effect.gen(function* () {
    if (rep) {
      yield* clientLog(
        "warn",
        "Closing existing Replicache instance before creating a new one.",
      );
      yield* Effect.promise(() => rep!.close());
    }

    const newRep = new Replicache<Mutators>({
      logLevel: "debug",
      name: `life-io-user-${userId}`,
      licenseKey: "l10f93d37bcd041beba8d111a72da0031",
      pushURL: "/api/replicache/push",
      pullURL: "/api/replicache/pull",
      pushDelay: 200,
      pullInterval: 60_000,
      mutators, // Import the combined mutators
    });

    rep = newRep;
    setupWebSocket(rep); // Pass the new instance to the WebSocket setup
    yield* clientLog("info", `Replicache initialized for user: ${userId}`);
    return newRep;
  }).pipe(
    Effect.catchAll((err) =>
      clientLog(
        "error",
        `Critical error during Replicache initialization: ${
          toError(err).message
        }`,
      ).pipe(Effect.andThen(Effect.die(err))),
    ),
  );
