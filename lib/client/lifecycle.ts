// =================================================================
// FILE: lib/client/lifecycle.ts
// =================================================================
import { Stream, Effect, Layer, Context, Chunk } from "effect";
import { authState, type AuthModel } from "./stores/authStore";
import { clientLog } from "./logger.client";
import { runClientUnscoped } from "./runtime";
import { LocationService } from "./LocationService";

export const authStream: Stream.Stream<AuthModel> = Stream.async<AuthModel>(
  (emit) => {
    runClientUnscoped(
      clientLog("debug", "authStream subscribed.", undefined, "lifecycle"),
    );
    void emit(Effect.succeed(Chunk.of(authState.value)));
    const unsubscribe = authState.subscribe((value) => {
      runClientUnscoped(
        clientLog(
          "debug",
          `authStream emitting status: ${value.status}`,
          value.user?.id,
          "lifecycle",
        ),
      );
      void emit(Effect.succeed(Chunk.of(value)));
    });
    return Effect.sync(() => {
      runClientUnscoped(
        clientLog("debug", "authStream unsubscribed.", undefined, "lifecycle"),
      );
      unsubscribe();
    });
  },
).pipe(
  Stream.changesWith(
    (a: AuthModel, b: AuthModel) =>
      a.status === b.status && a.user?.id === b.user?.id,
  ),
);

export const appStateStream: Stream.Stream<
  { path: string; auth: AuthModel },
  never,
  LocationService
> = Stream.unwrap(
  // FIX: Use Stream.unwrap to correctly flatten the Effect<Stream<...>>
  // This preserves the inner stream's type for the subsequent operators.
  Effect.gen(function* () {
    const location = yield* LocationService;
    return Stream.zipLatest(location.pathname, authStream);
  }),
).pipe(
  Stream.map(([path, auth]) => ({ path, auth })),
  Stream.tap(({ path, auth }) =>
    clientLog(
      "debug",
      `New app state: { path: "${path}", auth: "${auth.status}" }`,
      auth.user?.id,
      "AppStateStream",
    ),
  ),
);

export class ViewManager extends Context.Tag("ViewManager")<
  ViewManager,
  {
    readonly set: (cleanup: (() => void) | undefined) => Effect.Effect<void>;
    readonly cleanup: () => Effect.Effect<void>;
  }
>() {}

export const ViewManagerLive = Layer.sync(ViewManager, () => {
  let currentCleanup: (() => void) | undefined = undefined;
  return ViewManager.of({
    set: (cleanup) =>
      Effect.sync(() => {
        currentCleanup = cleanup;
      }),
    cleanup: () =>
      Effect.sync(() => {
        if (currentCleanup) {
          runClientUnscoped(
            clientLog(
              "debug",
              "ViewManager: Running cleanup.",
              undefined,
              "lifecycle",
            ),
          );
          currentCleanup();
          currentCleanup = undefined;
        }
      }),
  });
});
