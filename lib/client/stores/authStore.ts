// File: lib/client/stores/authStore.ts
import { signal } from "@preact/signals-core";
import { Effect, pipe } from "effect";
import { trpc } from "../../../lib/client/trpc";
import type { User } from "../../../types/generated/public/User";
import { runClientPromise } from "../runtime";
import { clientLog } from "../logger.client";

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

// --- Global State Signal ---
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

// --- Side-Effect "React" Function ---
const react = async (action: AuthAction) => {
  const currentUserId = authState.value.user?.id;
  switch (action.type) {
    case "AUTH_CHECK_START": {
      const authCheckEffect = pipe(
        clientLog("info", "Starting auth check...", undefined, "authStore"),
        Effect.andThen(
          Effect.tryPromise({
            try: () => trpc.auth.me.query(),
            catch: (err) => new Error(String(err)),
          }),
        ),
        Effect.flatMap((user) =>
          user
            ? pipe(
                clientLog(
                  "info",
                  `Auth check success for ${user.email}`,
                  user.id,
                  "authStore",
                ),
                Effect.andThen(
                  Effect.sync(() =>
                    proposeAuthAction({
                      type: "AUTH_CHECK_SUCCESS",
                      payload: user,
                    }),
                  ),
                ),
              )
            : pipe(
                clientLog(
                  "info",
                  "Auth check failed: No active session.",
                  undefined,
                  "authStore",
                ),
                Effect.andThen(
                  Effect.sync(() =>
                    proposeAuthAction({ type: "AUTH_CHECK_FAILURE" }),
                  ),
                ),
              ),
        ),
        Effect.catchAll((error) =>
          pipe(
            clientLog(
              "error",
              `Auth check threw an error: ${String(error)}`,
              undefined,
              "authStore",
            ),
            Effect.andThen(
              Effect.sync(() =>
                proposeAuthAction({ type: "AUTH_CHECK_FAILURE" }),
              ),
            ),
          ),
        ),
      );
      await runClientPromise(authCheckEffect);
      break;
    }
    case "LOGOUT_START": {
      const logoutEffect = pipe(
        clientLog(
          "info",
          "Logout process started.",
          currentUserId,
          "authStore",
        ),
        Effect.andThen(Effect.tryPromise(() => trpc.auth.logout.mutate())),
        Effect.tap(() =>
          Effect.sync(() => {
            document.cookie =
              "session_id=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
          }),
        ),
        Effect.andThen(
          pipe(
            clientLog(
              "info",
              "Logout successful, client-side cleanup complete.",
              currentUserId,
              "authStore",
            ),
            Effect.andThen(
              Effect.sync(() => proposeAuthAction({ type: "LOGOUT_SUCCESS" })),
            ),
          ),
        ),
        Effect.catchAll((error) =>
          pipe(
            clientLog(
              "warn",
              `Server logout failed, but proceeding with client-side cleanup: ${String(
                error,
              )}`,
              currentUserId,
              "authStore",
            ),
            Effect.andThen(
              Effect.sync(() => proposeAuthAction({ type: "LOGOUT_SUCCESS" })),
            ),
          ),
        ),
      );
      await runClientPromise(logoutEffect);
      break;
    }
  }
};

// --- Public Propose Function ---
export const proposeAuthAction = (action: AuthAction) => {
  authState.value = update(authState.value, action);
  void react(action);
};

// --- Initial Action ---
proposeAuthAction({ type: "AUTH_CHECK_START" });
