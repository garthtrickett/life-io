// File: ./components/pages/reset-password-page.ts
import { render, html, type TemplateResult, nothing } from "lit-html";
import { signal, effect } from "@preact/signals-core";
import { pipe, Effect, Data } from "effect";
import { trpc } from "../../lib/client/trpc";
import { navigate } from "../../lib/client/router";
import { NotionButton } from "../ui/notion-button";
import { runClientPromise } from "../../lib/client/runtime";

// --- Custom Error Types ---
class InvalidTokenError extends Data.TaggedError("InvalidTokenError") {}
class PasswordResetError extends Data.TaggedError("PasswordResetError")<{
  readonly cause: unknown;
}> {}

// --- Types ---
interface ViewResult {
  template: TemplateResult;
  cleanup?: () => void;
}
interface Model {
  password: string;
  status: "idle" | "loading" | "success" | "error";
  message: string | null;
}
type Action =
  | { type: "UPDATE_PASSWORD"; payload: string }
  | { type: "RESET_START" }
  | { type: "RESET_SUCCESS" }
  | { type: "RESET_ERROR"; payload: InvalidTokenError | PasswordResetError };

const model = signal<Model>({ password: "", status: "idle", message: null });

const update = (action: Action) => {
  switch (action.type) {
    case "UPDATE_PASSWORD":
      model.value = {
        ...model.value,
        password: action.payload,
        status: "idle",
        message: null,
      };
      break;
    case "RESET_START":
      model.value = { ...model.value, status: "loading", message: null };
      break;
    case "RESET_SUCCESS":
      model.value = {
        ...model.value,
        status: "success",
        message: "Password has been reset successfully. You can now log in.",
      };
      break;
    case "RESET_ERROR": {
      let errorMessage = "An unknown error occurred.";
      if (action.payload._tag === "InvalidTokenError") {
        errorMessage = "This password reset link is invalid or has expired.";
      }
      model.value = { ...model.value, status: "error", message: errorMessage };
      break;
    }
  }
};

const react = async (action: Action, token: string) => {
  if (action.type === "RESET_START") {
    const resetEffect = pipe(
      Effect.tryPromise({
        try: () =>
          trpc.auth.resetPassword.mutate({
            token,
            password: model.value.password,
          }),
        catch: (err) => {
          if (
            typeof err === "object" &&
            err !== null &&
            "data" in err &&
            (err.data as { code?: string }).code === "BAD_REQUEST"
          ) {
            return new InvalidTokenError();
          }
          return new PasswordResetError({ cause: err });
        },
      }),
      Effect.match({
        onSuccess: () => {
          propose(token)({ type: "RESET_SUCCESS" });
        },
        onFailure: (error) => {
          propose(token)({ type: "RESET_ERROR", payload: error });
        },
      }),
    );
    await runClientPromise(resetEffect);
  }
  if (action.type === "RESET_SUCCESS") {
    setTimeout(() => navigate("/login"), 3000);
  }
};

const propose = (token: string) => (action: Action) => {
  update(action);
  void react(action, token);
};

export const ResetPasswordView = (token: string): ViewResult => {
  const container = document.createElement("div");

  const renderView = effect(() => {
    const handleSubmit = (e: Event) => {
      e.preventDefault();
      if (model.value.status === "loading") return;
      propose(token)({ type: "RESET_START" });
    };

    const template = html`
      <div class="flex min-h-screen items-center justify-center bg-gray-100">
        <div class="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
          <h2 class="mb-6 text-center text-2xl font-bold">Reset Password</h2>
          ${model.value.status === "success"
            ? html` <div class="text-center text-green-600">
                  ${model.value.message}
                </div>
                <p class="mt-2 text-center text-sm">Redirecting to login...</p>`
            : html` <form @submit=${handleSubmit}>
                <div class="mb-6">
                  <label
                    for="password"
                    class="block text-sm font-medium text-gray-700"
                    >New Password (min. 8 characters)</label
                  >
                  <input
                    type="password"
                    id="password"
                    .value=${model.value.password}
                    @input=${(e: Event) =>
                      propose(token)({
                        type: "UPDATE_PASSWORD",
                        payload: (e.target as HTMLInputElement).value,
                      })}
                    class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-zinc-500 sm:text-sm"
                    required
                  />
                </div>
                ${model.value.message
                  ? html`<div class="mb-4 text-sm text-red-500">
                      ${model.value.message}
                    </div>`
                  : nothing}
                ${NotionButton({
                  children:
                    model.value.status === "loading"
                      ? "Resetting..."
                      : "Reset Password",
                  type: "submit",
                  loading: model.value.status === "loading",
                })}
              </form>`}
        </div>
      </div>
    `;
    render(template, container);
  });

  return {
    template: html`${container}`,
    cleanup: () => {
      renderView();
      model.value = { password: "", status: "idle", message: null };
    },
  };
};
