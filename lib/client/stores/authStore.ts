// File: lib/client/stores/authStore.ts
import { signal } from "@preact/signals-core";
import { Effect, pipe, Queue, Ref, Stream } from "effect";
import { trpc } from "../../../lib/client/trpc";
import type { User } from "../../../types/generated/public/User";
import { runClientUnscoped } from "../runtime";
import { clientLog } from "../logger.client";
import { rep, initReplicache, nullifyReplicache } from "../replicache";

// --- Model and Action Types ---
export interface AuthModel {
  status:
    | "initializing"
    | "unauthenticated"
    | "authenticating"
    | "authenticated";
  user: User | null;
}
type AuthAction =
  | { type: "AUTH_CHECK_START" }
  | { type: "AUTH_CHECK_SUCCESS"; payload: User }
  | { type: "AUTH_CHECK_FAILURE" }
  | { type: "LOGOUT_START" }
  | { type: "LOGOUT_SUCCESS" }
  | { type: "SET_AUTHENTICATED"; payload: User };

// --- Internal State Management ---
const _authStateRef = Ref.unsafeMake<AuthModel>({
  status: "initializing",
  user: null,
});
const _actionQueue = Effect.runSync(Queue.unbounded<AuthAction>());

// --- Globally Exposed State Signal ---
export const authState = signal<AuthModel>({
  status: "initializing",
  user: null,
});

// --- Pure Update Function ---
const update = (model: AuthModel, action: AuthAction): AuthModel => {
  switch (action.type) {
    case "AUTH_CHECK_START":
      return { ...model, status: "authenticating" };
    case "AUTH_CHECK_SUCCESS":
      return { status: "authenticated", user: action.payload };
    case "AUTH_CHECK_FAILURE":
      return { status: "unauthenticated", user: null };
    case "LOGOUT_START":
      return { ...model, status: "authenticating" };
    case "LOGOUT_SUCCESS":
      return { status: "unauthenticated", user: null };
    case "SET_AUTHENTICATED":
      return { status: "authenticated", user: action.payload };
    default:
      return model;
  }
};

// --- Side-Effect Handler ---
const handleAuthAction = (action: AuthAction): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const currentModel = yield* Ref.get(_authStateRef);
    const nextModel = update(currentModel, action);
    yield* Ref.set(_authStateRef, nextModel);
    yield* Effect.sync(() => {
      authState.value = nextModel;
    });

    const userId = currentModel.user?.id;

    switch (action.type) {
      case "AUTH_CHECK_SUCCESS": {
        yield* clientLog(
          "info",
          "Auth check success. Initializing Replicache.",
          action.payload.id,
        );
        yield* initReplicache(action.payload.id);
        break;
      }
      case "AUTH_CHECK_START": {
        const authCheckEffect = pipe(
          clientLog("info", "Starting auth check...", undefined, "authStore"),
          Effect.andThen(() =>
            Effect.tryPromise({
              try: () => trpc.auth.me.query(),
              // Instead of creating a generic error, we cast the cause to Error.
              // This preserves the specific TRPCClientError for better debugging.
              catch: (err) => err as Error,
            }),
          ),
          Effect.flatMap((user) =>
            user
              ? Effect.sync(() =>
                  proposeAuthAction({
                    type: "AUTH_CHECK_SUCCESS",
                    payload: user,
                  }),
                )
              : Effect.sync(() =>
                  proposeAuthAction({ type: "AUTH_CHECK_FAILURE" }),
                ),
          ),
          // The catchAll block now receives the original error.
          Effect.catchAll((error) =>
            pipe(
              clientLog("info", `Auth check failed: ${error.message}`),
              Effect.andThen(() =>
                proposeAuthAction({ type: "AUTH_CHECK_FAILURE" }),
              ),
            ),
          ),
        );
        yield* Effect.fork(authCheckEffect);
        break;
      }
      case "LOGOUT_START": {
        const cleanupAndFinalizeLogout = pipe(
          Effect.sync(() => {
            document.cookie =
              "session_id=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax";
          }),
          Effect.andThen(
            Effect.if(
              Effect.sync(() => !!(rep && userId)),
              {
                onTrue: () => {
                  const replicacheName = `life-io-user-${userId}`;
                  return pipe(
                    clientLog(
                      "info",
                      `Deleting IndexedDB database: ${replicacheName}`,
                      userId,
                      "authStore:replicache",
                    ),
                    Effect.andThen(
                      Effect.tryPromise({
                        try: () =>
                          new Promise<void>((resolve, reject) => {
                            const deleteRequest =
                              window.indexedDB.deleteDatabase(replicacheName);
                            deleteRequest.onsuccess = () => resolve();
                            deleteRequest.onerror = () =>
                              reject(
                                new Error(
                                  `Failed to delete IndexedDB: ${replicacheName}`,
                                ),
                              );
                            deleteRequest.onblocked = () =>
                              reject(
                                new Error(
                                  `Blocked from deleting IndexedDB: ${replicacheName}. Close other tabs.`,
                                ),
                              );
                          }),
                        catch: (e) => e as Error,
                      }),
                    ),
                    Effect.andThen(nullifyReplicache),
                    Effect.catchAll((err) =>
                      clientLog(
                        "error",
                        `Failed to delete Replicache DB: ${err.message}`,
                        userId,
                        "authStore:replicache",
                      ),
                    ),
                  );
                },
                onFalse: () =>
                  clientLog(
                    "debug",
                    "No active Replicache instance or user ID to delete.",
                  ),
              },
            ),
          ),
          Effect.andThen(() =>
            Effect.sync(() => proposeAuthAction({ type: "LOGOUT_SUCCESS" })),
          ),
        );
        const logoutEffect = pipe(
          clientLog("info", "Logout process started.", userId, "authStore"),
          Effect.andThen(() =>
            Effect.tryPromise(() => trpc.auth.logout.mutate()),
          ),
          Effect.andThen(cleanupAndFinalizeLogout),
          Effect.catchAll((error) =>
            pipe(
              clientLog(
                "warn",
                `Server logout failed, but proceeding with client-side cleanup: ${String(
                  error,
                )}`,
                userId,
                "authStore",
              ),
              Effect.andThen(cleanupAndFinalizeLogout),
            ),
          ),
        );
        yield* Effect.fork(logoutEffect);
        break;
      }
      case "SET_AUTHENTICATED": {
        yield* clientLog(
          "info",
          "User set to authenticated. Initializing Replicache.",
          action.payload.id,
        );
        yield* initReplicache(action.payload.id);
        break;
      }
    }
  });

// --- Main Store Process ---
const authProcess = Stream.fromQueue(_actionQueue).pipe(
  Stream.runForEach(handleAuthAction),
);

// --- Start all background processes for the store ---
runClientUnscoped(authProcess);

// --- Public Propose Function ---
export const proposeAuthAction = (action: AuthAction): void => {
  runClientUnscoped(Queue.offer(_actionQueue, action));
};

// --- Initial Action ---
proposeAuthAction({ type: "AUTH_CHECK_START" });
