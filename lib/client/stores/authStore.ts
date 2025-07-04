// FILE: lib/client/stores/authStore.ts
import { signal } from "@preact/signals-core";
import { Effect, pipe, Queue, Ref, Stream, Data } from "effect"; // Import Data
import { trpc } from "../../../lib/client/trpc";
import type { User } from "../../../types/generated/public/User";
import { runClientUnscoped } from "../runtime";
import { clientLog } from "../logger.client";
import { rep, initReplicache, nullifyReplicache } from "../replicache";
import { makeIDBName, dropDatabase } from "replicache";
// --- START OF FIX: Import the toError utility ---
import { toError } from "../../../lib/shared/toError";
// --- END OF FIX ---

/* ─────────────────────────── Helpers ──────────────────────────── */
const expireCookie = (name: string) => {
  const base = `${name}=; path=/; SameSite=Lax`;
  const expiry = "expires=Thu, 01 Jan 1970 00:00:00 GMT";
  const host = location.hostname;
  document.cookie = `${base}; ${expiry}`;
  document.cookie = `${base}; Max-Age=0`;
  document.cookie = `${base}; domain=${host}; ${expiry}`;
  document.cookie = `${base}; domain=${host}; Max-Age=0`;
};

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
        const logoutEffect = Effect.gen(function* () {
          const userId = currentModel.user?.id;
          yield* clientLog("info", "Logout process started.", userId);

          const logicalName = userId ? `life-io-user-${userId}` : undefined;
          const idbName = logicalName ? makeIDBName(logicalName) : undefined;

          if (rep) {
            yield* clientLog("info", "Closing Replicache instance…", userId);
            yield* Effect.promise(() => rep!.close());
            yield* nullifyReplicache();
          }

          if (idbName) {
            yield* clientLog("info", `Dropping DB "${idbName}"`, userId);
            yield* Effect.promise(() => dropDatabase(idbName));

            yield* clientLog(
              "info",
              'Dropping meta DB "replicache-dbs-v0"',
              userId,
            );
            yield* Effect.promise(() => dropDatabase("replicache-dbs-v0"));
          }

          expireCookie("session_id");

          yield* clientLog("info", "Invalidating server session…", userId);
          // --- START OF FIX: Use the toError utility for safe error conversion ---
          yield* Effect.tryPromise({
            try: () => trpc.auth.logout.mutate(),
            catch: (err) => toError(err), // Safe conversion
          });
          // --- END OF FIX ---
        }).pipe(
          Effect.catchAll((error) =>
            clientLog(
              "error",
              `An error occurred during logout: ${error.message}`,
              currentModel.user?.id,
            ),
          ),
          Effect.andThen(() =>
            Effect.sync(() => proposeAuthAction({ type: "LOGOUT_SUCCESS" })),
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

const authProcess = Stream.fromQueue(_actionQueue).pipe(
  Stream.runForEach(handleAuthAction),
);
runClientUnscoped(authProcess);

export const proposeAuthAction = (action: AuthAction): void => {
  runClientUnscoped(Queue.offer(_actionQueue, action));
};

proposeAuthAction({ type: "AUTH_CHECK_START" });
