// lib/client/stores/authStore.ts
import { signal } from "@preact/signals-core";
import { Effect, pipe, Queue, Ref, Stream } from "effect";
import { trpc } from "../../../lib/client/trpc";
import type { User } from "../../../types/generated/public/User";
import { runClientUnscoped } from "../runtime";
import { clientLog } from "../logger.client";
import { rep, initReplicache, nullifyReplicache } from "../replicache";
import { makeIDBName, dropDatabase } from "replicache";

/* ─────────────────────────── Helpers ──────────────────────────── */

/** Expire a cookie in every reasonable permutation. */
const expireCookie = (name: string) => {
  const base = `${name}=; path=/; SameSite=Lax`;
  const expiry = "expires=Thu, 01 Jan 1970 00:00:00 GMT";
  const host = location.hostname;

  // Host-only (no domain) — expires & Max-Age
  document.cookie = `${base}; ${expiry}`;
  document.cookie = `${base}; Max-Age=0`;

  // Explicit domain — expires & Max-Age
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

type AuthAction =
  | { type: "AUTH_CHECK_START" }
  | { type: "AUTH_CHECK_SUCCESS"; payload: User }
  | { type: "AUTH_CHECK_FAILURE" }
  | { type: "LOGOUT_START" }
  | { type: "LOGOUT_SUCCESS" }
  | { type: "SET_AUTHENTICATED"; payload: User };

/* ───────────────────────── Internal State ────────────────────────────── */

const _authStateRef = Ref.unsafeMake<AuthModel>({
  status: "initializing",
  user: null,
});
const _actionQueue = Effect.runSync(Queue.unbounded<AuthAction>());

/* ───────────────────────── Public Signal ─────────────────────────────── */

export const authState = signal<AuthModel>({
  status: "initializing",
  user: null,
});

/* ──────────────────────── Pure Update Function ───────────────────────── */

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

/* ───────────────────── Side-Effect Processor ─────────────────────────── */

const handleAuthAction = (action: AuthAction): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const currentModel = yield* Ref.get(_authStateRef);
    const nextModel = update(currentModel, action);
    yield* Ref.set(_authStateRef, nextModel);
    yield* Effect.sync(() => {
      authState.value = nextModel;
    });

    switch (action.type) {
      /* ---------- login / session restore ---------- */
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
          Effect.catchAll((error) =>
            pipe(
              clientLog(
                "info",
                `Auth check failed: ${error.message}`,
                undefined,
                "authStore",
              ),
              Effect.andThen(() =>
                proposeAuthAction({ type: "AUTH_CHECK_FAILURE" }),
              ),
            ),
          ),
        );
        yield* Effect.fork(authCheckEffect);
        break;
      }

      /* -------------------- LOGOUT -------------------- */
      case "LOGOUT_START": {
        const logoutEffect = Effect.gen(function* () {
          const userId = currentModel.user?.id;
          yield* clientLog("info", "Logout process started.", userId);

          /* 1️⃣  Compute logical & physical DB names */
          const logicalName = userId ? `life-io-user-${userId}` : undefined;
          const idbName = logicalName ? makeIDBName(logicalName) : undefined;

          /* 2️⃣  Close Replicache */
          if (rep) {
            yield* clientLog("info", "Closing Replicache instance…", userId);
            yield* Effect.promise(() => rep!.close());
            yield* nullifyReplicache();
          }

          /* 3️⃣  Drop IndexedDBs */
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

          /* 4️⃣  Clear the session cookie (all variants) */
          expireCookie("session_id");

          /* 5️⃣  Tell the server to invalidate the session */
          yield* clientLog("info", "Invalidating server session…", userId);
          yield* Effect.tryPromise({
            try: () => trpc.auth.logout.mutate(),
            catch: (err) => err as Error,
          });
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

      /* ---------- Manual set (e.g. after signup) ---------- */
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

/* ───────────────────────── Store Runtime ─────────────────────────────── */

const authProcess = Stream.fromQueue(_actionQueue).pipe(
  Stream.runForEach(handleAuthAction),
);
runClientUnscoped(authProcess);

/* ───────────────────────── Public API ────────────────────────────────── */

export const proposeAuthAction = (action: AuthAction): void => {
  runClientUnscoped(Queue.offer(_actionQueue, action));
};

/* Kick off an initial auth check on startup */
proposeAuthAction({ type: "AUTH_CHECK_START" });
