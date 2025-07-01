// File: store/authStore.ts
import { signal } from "@preact/signals-core";
import { Effect, pipe } from "effect";
import { trpc } from "../../../lib/client/trpc";
import type { User } from "../../../types/generated/public/User";

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
  switch (action.type) {
    case "AUTH_CHECK_START": {
      await pipe(
        Effect.tryPromise({
          try: () => trpc.auth.me.query(),
          catch: (err) => new Error(String(err)),
        }),
        // --- FIX: Handle the `User | null` return type explicitly ---
        Effect.flatMap((user) =>
          user
            ? Effect.succeed(
                proposeAuthAction({
                  type: "AUTH_CHECK_SUCCESS",
                  payload: user,
                }),
              )
            : Effect.succeed(proposeAuthAction({ type: "AUTH_CHECK_FAILURE" })),
        ),
        Effect.catchAll(() =>
          Effect.succeed(proposeAuthAction({ type: "AUTH_CHECK_FAILURE" })),
        ),
        Effect.runPromise,
      );
      break;
    }
    case "LOGOUT_START": {
      await pipe(
        Effect.tryPromise(() => trpc.auth.logout.mutate()),
        Effect.tap(() =>
          Effect.sync(() => {
            document.cookie =
              "session_id=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
          }),
        ),
        Effect.andThen(() => proposeAuthAction({ type: "LOGOUT_SUCCESS" })),
        Effect.catchAll(() =>
          Effect.succeed(proposeAuthAction({ type: "LOGOUT_SUCCESS" })),
        ), // Logout on client even if server fails
        Effect.runPromise,
      );
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
