// FILE: lib/client/stores/authStore.ts
import { trpc } from "../trpc";
import { User } from "../../../types/generated/public/User";
import { clientLog } from "../logger.client";
import { signal, type Signal } from "@preact/signals-core";
import { runClientEffect } from "../runtime";

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

class AuthStore {
  public stateSignal: Signal<AuthModel> = signal({
    status: "initializing",
    user: null,
  });

  public initialAuthCheck: Promise<void>;
  private _resolveInitialAuthCheck!: () => void;

  constructor() {
    this.initialAuthCheck = new Promise((resolve) => {
      this._resolveInitialAuthCheck = resolve;
    });
    runClientEffect(
      clientLog(
        "info",
        "AuthStore initialized. Starting first auth check.",
        undefined,
        "AuthStore:constructor",
      ),
    );
    void this.propose({ type: "AUTH_CHECK_START" });
  }

  get state(): AuthModel {
    return this.stateSignal.value;
  }

  propose(action: AuthAction) {
    const oldStatus = this.state.status;
    runClientEffect(
      clientLog(
        "debug",
        `Proposing action: ${action.type}`,
        this.state.user?.id,
        "AuthStore:propose",
      ),
    );

    this.stateSignal.value = update(this.state, action);

    if (this.state.status !== oldStatus) {
      runClientEffect(
        clientLog(
          "info",
          `Auth state changed from '${oldStatus}' to '${this.state.status}'`,
          this.state.user?.id,
          "AuthStore:propose",
        ),
      );
    }
    void this.react(action);
  }

  private async react(action: AuthAction) {
    switch (action.type) {
      case "AUTH_CHECK_START":
        runClientEffect(
          clientLog(
            "info",
            "Reacting to AUTH_CHECK_START. Calling trpc.auth.me.query...",
            undefined,
            "AuthStore:react",
          ),
        );
        try {
          const user = await trpc.auth.me.query();
          if (user) {
            runClientEffect(
              clientLog(
                "debug",
                "trpc.auth.me returned a user. Proposing AUTH_CHECK_SUCCESS.",
                user.id,
                "AuthStore:react",
              ),
            );
            this.propose({ type: "AUTH_CHECK_SUCCESS", payload: user });
          } else {
            runClientEffect(
              clientLog(
                "debug",
                "trpc.auth.me returned null. Proposing AUTH_CHECK_FAILURE.",
                undefined,
                "AuthStore:react",
              ),
            );
            this.propose({ type: "AUTH_CHECK_FAILURE" });
          }
        } catch (err) {
          runClientEffect(
            clientLog(
              "error",
              `trpc.auth.me call failed: ${String(
                err,
              )}. Proposing AUTH_CHECK_FAILURE.`,
              undefined,
              "AuthStore:react",
            ),
          );
          this.propose({ type: "AUTH_CHECK_FAILURE" });
        } finally {
          runClientEffect(
            clientLog(
              "info",
              "Initial auth check promise is being resolved.",
              undefined,
              "AuthStore:react",
            ),
          );
          this._resolveInitialAuthCheck();
        }
        break;

      case "AUTH_CHECK_SUCCESS":
        runClientEffect(
          clientLog(
            "info",
            `Reacting to AUTH_CHECK_SUCCESS. User: ${action.payload.email}`,
            action.payload.id,
            "AuthStore:react",
          ),
        );
        break;

      case "AUTH_CHECK_FAILURE":
        runClientEffect(
          clientLog(
            "info",
            "Reacting to AUTH_CHECK_FAILURE. No active session.",
            undefined,
            "AuthStore:react",
          ),
        );
        break;

      case "LOGOUT_START":
        runClientEffect(
          clientLog(
            "info",
            "Reacting to LOGOUT_START. Calling trpc.auth.logout...",
            this.state.user?.id,
            "AuthStore:react",
          ),
        );
        try {
          await trpc.auth.logout.mutate();
          runClientEffect(
            clientLog(
              "info",
              "Server-side logout successful.",
              this.state.user?.id,
              "AuthStore:react",
            ),
          );
        } catch (error) {
          runClientEffect(
            clientLog(
              "error",
              `Server-side logout failed: ${String(
                error,
              )}. Will clean up client-side anyway.`,
              this.state.user?.id,
              "AuthStore:react",
            ),
          );
        } finally {
          runClientEffect(
            clientLog(
              "info",
              "Clearing session cookie and proposing LOGOUT_SUCCESS.",
              this.state.user?.id,
              "AuthStore:react",
            ),
          );
          document.cookie =
            "session_id=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
          this.propose({ type: "LOGOUT_SUCCESS" });
        }
        break;
    }
  }

  logout() {
    this.propose({ type: "LOGOUT_START" });
  }

  hasPerm(perm: string): boolean {
    return this.state.user?.permissions?.includes(perm) ?? false;
  }
}

export const authStore = new AuthStore();
