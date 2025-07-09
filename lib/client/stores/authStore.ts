// FILE: lib/client/stores/authStore.ts
import { signal } from "@preact/signals-core";
import {
  Effect,
  pipe,
  Queue,
  Ref,
  Stream,
  Data,
  Schedule,
  Option,
  Duration,
} from "effect";
import { trpc } from "../../../lib/client/trpc";
import type { User, UserId } from "../../../types/generated/public/User";
import { runClientUnscoped } from "../runtime";
import { clientLog } from "../logger.client";
import { rep, initReplicache, nullifyReplicache } from "../replicache/index";
import { makeIDBName, dropDatabase } from "replicache";
import { toError } from "../../../lib/shared/toError";
/* ─────────────────────────── Helpers ──────────────────────────── */
const CLEANUP_FLAG_KEY = "life-io-db-cleanup-pending";
const expireCookieEffect = (name: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* clientLog(
      "debug",
      `[expireCookieEffect] Attempting to expire cookie: ${name}`,
      undefined,
      "authStore:expireCookie",
    );
    const base = `${name}=; path=/; SameSite=Lax`;
    const expiry = "expires=Thu, 01 Jan 1970 00:00:00 GMT";
    const host = location.hostname;

    const cookieCommands = [
      `${base}; ${expiry}`,
      `${base}; Max-Age=0`,
      `${base}; domain=${host}; ${expiry}`,
      `${base}; domain=${host}; Max-Age=0`,
    ];

    for (let i = 0; i < cookieCommands.length; i++) {
      const cmd = cookieCommands[i];
      yield* clientLog(
        "debug",
        `[expireCookieEffect] Setting cookie (command ${i + 1}): "${cmd}"`,
        undefined,
        "authStore:expireCookie",
      );
      yield* Effect.sync(() => {
        document.cookie = cmd;
      });
    }
    yield* clientLog(
      "info",
      "[expireCookieEffect] All cookie expiration commands sent.",
      undefined,
      "authStore:expireCookie",
    );
  });

/** Sets a flag in localStorage to indicate a user's DB needs cleanup.
 */
const setCleanupFlag = (userId: UserId): Effect.Effect<void> =>
  Effect.sync(() => {
    localStorage.setItem(CLEANUP_FLAG_KEY, userId);
  }).pipe(
    Effect.andThen(
      clientLog(
        "info",
        `Set DB cleanup flag for user: ${userId}`,
        userId,
        "authStore:durableCleanup",
      ),
    ),
  );
/** Clears the cleanup flag from localStorage. */
const clearCleanupFlag = (): Effect.Effect<void> =>
  Effect.sync(() => {
    localStorage.removeItem(CLEANUP_FLAG_KEY);
  }).pipe(
    Effect.andThen(
      clientLog(
        "info",
        "Cleared DB cleanup flag.",
        undefined,
        "authStore:durableCleanup",
      ),
    ),
  );
/** Reads the user ID from the cleanup flag, if it exists.
 */
const getPendingCleanupUserId = (): Effect.Effect<Option.Option<UserId>> =>
  Effect.sync(() =>
    Option.fromNullable(localStorage.getItem(CLEANUP_FLAG_KEY) as UserId),
  );
/**
 * The core logic for closing Replicache and dropping the IndexedDB databases.
 * This is the operation we want to guarantee.
 */
const performLocalDbCleanup = (userId: UserId): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    yield* clientLog(
      "info",
      `Performing local DB cleanup for user: ${userId}`,
      userId,
      "authStore:durableCleanup",
    );
    const logicalName = `life-io-user-${userId}`;
    const idbName = makeIDBName(logicalName);

    if (rep && rep.name === logicalName) {
      yield* clientLog(
        "info",
        "Closing active Replicache instance...",
        userId,
        "authStore:durableCleanup",
      );
      yield* Effect.promise(() => rep!.close());
      yield* nullifyReplicache();
    }

    yield* clientLog(
      "info",
      `Dropping DB "${idbName}"`,
      userId,
      "authStore:durableCleanup",
    );
    yield* Effect.promise(() => dropDatabase(idbName));
    yield* clientLog(
      "info",
      'Dropping meta DB "replicache-dbs-v0"',
      userId,
      "authStore:durableCleanup",
    );
    yield* Effect.promise(() => dropDatabase("replicache-dbs-v0"));
    yield* clientLog(
      "info",
      "Local DB cleanup successful.",
      userId,
      "authStore:durableCleanup",
    );
  }).pipe(Effect.mapError((cause) => toError(cause)));

/**
 * Checks for a pending cleanup flag on app start and executes the cleanup if needed.
 * Returns an effect that completes when cleanup is done, or immediately if not needed.
 */
const checkAndRunPendingCleanup = (): Effect.Effect<void> =>
  Effect.gen(function* () {
    const maybeUserId = yield* getPendingCleanupUserId();
    if (Option.isSome(maybeUserId)) {
      yield* clientLog(
        "warn",
        `Found pending DB cleanup for user: ${maybeUserId.value}. Running now.`,
        maybeUserId.value,
        "authStore:durableCleanup",
      );
      // **THE FIX**: Directly yield the cleanup Effect instead of running it as a promise.
      // This ensures it completes as part of the main Effect flow before auth continues.
      yield* performLocalDbCleanup(maybeUserId.value).pipe(
        Effect.andThen(clearCleanupFlag()),
        Effect.catchAll((error) =>
          clientLog(
            "error",
            `Pending DB cleanup failed: ${error.message}`,
            maybeUserId.value,
            "authStore:durableCleanup",
          ),
        ),
      );
    }
  });
/* ─────────────────────────── Model & Actions ─────────────────────────── */

export interface AuthModel {
  status:
    | "initializing"
    | "unauthenticated"
    | "authenticating"
    | "authenticated";
  user: User | null;
}

class AuthCheckError extends Data.TaggedError("AuthCheckError")<{
  readonly cause: unknown;
}> {}

type AuthAction =
  | { type: "AUTH_CHECK_START" }
  | { type: "AUTH_CHECK_SUCCESS"; payload: User }
  | { type: "AUTH_CHECK_FAILURE"; payload: AuthCheckError }
  | { type: "LOGOUT_START" }
  | { type: "LOGOUT_SUCCESS" }
  | { type: "SET_AUTHENTICATED"; payload: User };
const _authStateRef = Ref.unsafeMake<AuthModel>({
  status: "initializing",
  user: null,
});
const _actionQueue = Effect.runSync(Queue.unbounded<AuthAction>());
export const authState = signal<AuthModel>({
  status: "initializing",
  user: null,
});
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

const handleAuthAction = (action: AuthAction): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const currentModel = yield* Ref.get(_authStateRef);
    const nextModel = update(currentModel, action);
    yield* Ref.set(_authStateRef, nextModel);
    yield* Effect.sync(() => {
      authState.value = nextModel;
    });

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
          Effect.andThen(checkAndRunPendingCleanup()),
          Effect.andThen(() =>
            Effect.tryPromise({
              try: () => trpc.auth.me.query(),
              catch: (cause) => new AuthCheckError({ cause }),
            }),
          ),
          Effect.match({
            onSuccess: (user) => {
              if (user) {
                proposeAuthAction({
                  type: "AUTH_CHECK_SUCCESS",
                  payload: user,
                });
              } else {
                proposeAuthAction({
                  type: "AUTH_CHECK_FAILURE",
                  payload: new AuthCheckError({ cause: "No user returned" }),
                });
              }
            },
            onFailure: (error) => {
              proposeAuthAction({ type: "AUTH_CHECK_FAILURE", payload: error });
            },
          }),
        );
        yield* Effect.fork(authCheckEffect);
        break;
      }
      case "AUTH_CHECK_FAILURE": {
        yield* clientLog(
          "info",
          `Auth check failed. Cause: ${JSON.stringify(action.payload.cause)}`,
          undefined,
          "authStore",
        );
        break;
      }
      case "LOGOUT_START": {
        const userId = currentModel.user?.id;
        if (!userId) {
          yield* clientLog(
            "warn",
            "Logout triggered but no user was logged in. Clearing state.",
            undefined,
            "authStore:logout",
          );
          proposeAuthAction({ type: "LOGOUT_SUCCESS" });
          return;
        }

        yield* clientLog(
          "info",
          "LOGOUT_START action received. Beginning robust logout process.",
          userId,
          "authStore:logout",
        );
        const serverLogout = Effect.tryPromise({
          try: () => trpc.auth.logout.mutate(),
          catch: (err) => toError(err),
        }).pipe(
          Effect.retry(
            Schedule.exponential(Duration.millis(200), 2).pipe(
              Schedule.intersect(Schedule.recurs(3)),
            ),
          ),
          Effect.tap(() =>
            clientLog(
              "info",
              "Server session invalidated successfully after retries.",
              userId,
              "authStore:logout",
            ),
          ),
        );
        const guaranteedClientUpdate = expireCookieEffect("session_id").pipe(
          Effect.andThen(() => proposeAuthAction({ type: "LOGOUT_SUCCESS" })),
        );
        const fullLogoutProcess = serverLogout.pipe(
          Effect.ensuring(guaranteedClientUpdate),
          Effect.catchAll((error) =>
            clientLog(
              "error",
              `Server logout failed permanently: ${
                toError(error).message
              }. Client has still been logged out.`,
              userId,
              "authStore:logout",
            ),
          ),
        );
        // Fork the entire robust logout process.
        yield* Effect.fork(fullLogoutProcess);

        // Separately, set the cleanup flag and fork the non-critical cleanup.
        yield* setCleanupFlag(userId);
        yield* Effect.fork(
          performLocalDbCleanup(userId).pipe(
            Effect.andThen(clearCleanupFlag()),
            Effect.catchAll((error) =>
              clientLog(
                "error",
                `Forked DB cleanup failed: ${error.message}`,
                userId,
                "authStore:logout",
              ),
            ),
          ),
        );
        break;
      }
      case "LOGOUT_SUCCESS": {
        yield* clientLog(
          "info",
          "LOGOUT_SUCCESS action handled. Final state is unauthenticated.",
          undefined,
          "authStore:logout",
        );
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

const authProcess = Stream.fromQueue(_actionQueue).pipe(
  Stream.runForEach(handleAuthAction),
);
runClientUnscoped(authProcess);
export const proposeAuthAction = (action: AuthAction): void => {
  runClientUnscoped(Queue.offer(_actionQueue, action));
};

proposeAuthAction({ type: "AUTH_CHECK_START" });
