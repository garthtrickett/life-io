// lib/client/lifecycle.ts
import { Stream, Effect, Layer, Context, Chunk } from "effect";
import { authState, type AuthModel } from "./stores/authStore";
import { clientLog } from "./logger.client";

// --- Location Stream ---
export interface LocationChange {
  readonly path: string;
}

export const locationStream: Stream.Stream<LocationChange> =
  Stream.async<LocationChange>((emit) => {
    const emitPath = (path: string) =>
      emit(Effect.succeed(Chunk.fromIterable([{ path }])));

    emitPath(window.location.pathname);

    const onPopState = () => {
      emitPath(window.location.pathname);
    };

    const onNavigateTo = (e: Event) => {
      const { path } = (e as CustomEvent<{ path: string }>).detail;
      if (window.location.pathname !== path) {
        window.history.pushState({}, "", path);
        emitPath(path);
      }
    };

    window.addEventListener("popstate", onPopState);
    window.addEventListener("navigate-to", onNavigateTo);

    return Effect.sync(() => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("navigate-to", onNavigateTo);
    });
  }).pipe(
    Stream.changesWith(
      (a: LocationChange, b: LocationChange) => a.path === b.path,
    ),
  );

// --- Auth Stream ---
export const authStream: Stream.Stream<AuthModel> = Stream.async<AuthModel>(
  (emit) => {
    emit(Effect.succeed(Chunk.of(authState.value)));
    const unsubscribe = authState.subscribe((value) => {
      emit(Effect.succeed(Chunk.of(value)));
    });
    return Effect.sync(unsubscribe);
  },
).pipe(
  Stream.changesWith(
    (a: AuthModel, b: AuthModel) =>
      a.status === b.status && a.user?.id === b.user?.id,
  ),
);

// --- Combined App State Stream ---
// --- FIX: Use Stream.zipLatest with Stream.map instead of Stream.combine ---
// `Stream.zipLatest` emits a tuple `[A, B]` whenever either stream emits a new
// value, using the most recent value from the other stream. This is more
// type-safe and avoids the overload resolution issues seen with `Stream.combine`.
export const appStateStream = Stream.zipLatest(locationStream, authStream).pipe(
  Stream.map(([location, auth]) => ({
    path: location.path,
    auth,
  })),
  Stream.tap(({ path, auth }) =>
    clientLog(
      "debug",
      `New app state: { path: "${path}", auth: "${auth.status}" }`,
      auth.user?.id,
      "AppStateStream",
    ),
  ),
);

// --- Service for View Cleanup ---
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
        currentCleanup?.();
        currentCleanup = undefined;
      }),
  });
});
