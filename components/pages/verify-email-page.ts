// File: ./components/pages/verify-email-page.ts (Refactored)
import { html, type TemplateResult } from "lit-html";
import { signal } from "@preact/signals-core";
import { pipe, Effect, Data } from "effect";
import { trpc } from "../../lib/client/trpc";
import { runClientPromise, runClientUnscoped } from "../../lib/client/runtime";
import { proposeAuthAction } from "../../lib/client/stores/authStore";
import { navigate } from "../../lib/client/router";
import type { User } from "../../types/generated/public/User";
import { clientLog } from "../../lib/client/logger.client";

// --- Custom Error Types ---
class InvalidTokenError extends Data.TaggedError("InvalidTokenError") {}
class UnknownVerificationError extends Data.TaggedError(
  "UnknownVerificationError",
)<{
  readonly cause: unknown;
}> {}

interface ViewResult {
  template: TemplateResult;
  cleanup?: () => void;
}

interface Model {
  status: "verifying" | "success" | "error";
  message: string | null;
}

interface VerifySuccessPayload {
  user: User;
  sessionId: string;
}
type Action =
  | { type: "VERIFY_START" }
  | { type: "VERIFY_SUCCESS"; payload: VerifySuccessPayload }
  | {
      type: "VERIFY_ERROR";
      payload: InvalidTokenError | UnknownVerificationError;
    };

const model = signal<Model>({ status: "verifying", message: null });

const update = (action: Action) => {
  switch (action.type) {
    case "VERIFY_START":
      model.value = { status: "verifying", message: "Verifying your email..." };
      break;
    case "VERIFY_SUCCESS":
      model.value = {
        status: "success",
        message: "Email verified successfully! You can now log in.",
      };
      break;
    case "VERIFY_ERROR": {
      let errorMessage = "An unknown error occurred during verification.";
      if (action.payload._tag === "InvalidTokenError") {
        errorMessage = "This verification link is invalid or has expired.";
      }
      model.value = { status: "error", message: errorMessage };
      break;
    }
  }
};

const react = async (action: Action, token: string) => {
  if (action.type === "VERIFY_START") {
    const verifyEffect = pipe(
      Effect.tryPromise({
        try: () => trpc.auth.verifyEmail.mutate({ token }),
        catch: (err) => {
          if (
            typeof err === "object" &&
            err !== null &&
            "data" in err &&
            (err.data as { code?: string }).code === "BAD_REQUEST"
          ) {
            return new InvalidTokenError();
          }
          return new UnknownVerificationError({ cause: err });
        },
      }),
      Effect.match({
        onSuccess: (result) => {
          propose(token)({
            type: "VERIFY_SUCCESS", // The payload is now an object
            payload: result,
          });
        },
        onFailure: (error) => {
          propose(token)({ type: "VERIFY_ERROR", payload: error });
        },
      }),
    );
    await runClientPromise(verifyEffect);
  }
  if (action.type === "VERIFY_SUCCESS") {
    const { user, sessionId } = action.payload;
    const expires = new Date();
    expires.setDate(expires.getDate() + 30);
    document.cookie = `session_id=${sessionId}; path=/; expires=${expires.toUTCString()}; SameSite=Lax`;
    proposeAuthAction({ type: "SET_AUTHENTICATED", payload: user });
    runClientUnscoped(
      clientLog(
        "info",
        "Email verified and user logged in. Navigating to home.",
      ),
    );
    navigate("/");
  }
};

const propose = (token: string) => (action: Action) => {
  update(action);
  void react(action, token);
};

export const VerifyEmailView = (token: string): ViewResult => {
  // FIX: Replace useEffect with a one-time-run condition check.
  // This ensures the verification starts automatically only on the first render.
  if (model.value.status === "verifying" && model.value.message === null) {
    propose(token)({ type: "VERIFY_START" });
  }

  const renderContent = () => {
    switch (model.value.status) {
      case "verifying":
        return html` <div
            class="h-12 w-12 animate-spin rounded-full border-4 border-zinc-300 border-t-zinc-600"
          ></div>
          <p class="mt-4 text-zinc-600">
            ${model.value.message || "Verifying..."}
          </p>`;
      case "success":
        return html` <h2 class="text-2xl font-bold text-green-600">Success!</h2>
          <p class="mt-4 text-zinc-600">${model.value.message}</p>
          <p class="mt-2 text-sm text-zinc-500">
            Redirecting you to your notes...
          </p>`;
      case "error":
        return html` <h2 class="text-2xl font-bold text-red-600">Error</h2>
          <p class="mt-4 text-zinc-600">${model.value.message}</p>
          <div class="mt-6">
            <a
              href="/login"
              class="font-medium text-zinc-600 hover:text-zinc-500"
              >Back to Login</a
            >
          </div>`;
    }
  };

  return {
    template: html`
      <div class="flex min-h-screen items-center justify-center bg-gray-100">
        <div
          class="flex w-full max-w-md flex-col items-center rounded-lg bg-white p-8 text-center shadow-md"
        >
          ${renderContent()}
        </div>
      </div>
    `,
    cleanup: () => {
      // Reset the state when the view is unmounted.
      model.value = { status: "verifying", message: null };
    },
  };
};
