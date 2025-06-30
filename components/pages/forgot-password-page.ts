// File: ./components/pages/forgot-password-page.ts
// File: ./components/pages/forgot-password-page.ts (Refactored)
import { html, type TemplateResult, nothing } from "lit-html";
import { signal } from "@preact/signals-core";
import { pipe, Effect, Data } from "effect";
import { trpc } from "../../lib/client/trpc";
import { clientLog } from "../../lib/client/logger.client";
import { runClientPromise } from "../../lib/client/runtime";
import { NotionButton } from "../ui/notion-button";
import { navigate } from "../../lib/client/router";

// --- Custom Error Types ---
class RequestResetError extends Data.TaggedError("RequestResetError")<{
  readonly cause: unknown;
}> {}

// --- Types ---
interface ViewResult {
  template: TemplateResult;
  cleanup?: () => void;
}
interface Model {
  email: string;
  status: "idle" | "loading" | "success" | "error";
  message: string | null;
}
type Action =
  | { type: "UPDATE_EMAIL"; payload: string }
  | { type: "REQUEST_START" }
  | { type: "REQUEST_SUCCESS"; payload: string }
  | { type: "REQUEST_ERROR"; payload: RequestResetError };

const model = signal<Model>({ email: "", status: "idle", message: null });

const update = (action: Action) => {
  switch (action.type) {
    case "UPDATE_EMAIL":
      model.value = {
        ...model.value,
        email: action.payload,
        status: "idle",
        message: null,
      };
      break;
    case "REQUEST_START":
      model.value = { ...model.value, status: "loading", message: null };
      break;
    case "REQUEST_SUCCESS":
      model.value = {
        ...model.value,
        status: "success",
        message: action.payload,
        email: "",
      };
      break;
    case "REQUEST_ERROR":
      // For security, we show the same message on error as on success.
      // This prevents leaking information about which emails are registered.
      // The specific error is logged internally.
      model.value = {
        ...model.value,
        status: "success",
        message:
          "If an account with that email exists, a password reset link has been sent.",
      };
      break;
  }
};

const react = async (action: Action) => {
  if (action.type === "REQUEST_START") {
    const requestEffect = pipe(
      Effect.tryPromise({
        try: () =>
          trpc.auth.requestPasswordReset.mutate({ email: model.value.email }),
        catch: (err) => new RequestResetError({ cause: err }),
      }),
      Effect.tap(() =>
        clientLog(
          "info",
          `Password reset requested for ${model.value.email}.`,
          undefined,
          "ForgotPassword",
        ),
      ),
      Effect.match({
        onSuccess: () => {
          propose({
            type: "REQUEST_SUCCESS",
            payload:
              "If an account with that email exists, a password reset link has been sent.",
          });
        },
        onFailure: (error) => {
          clientLog(
            "error",
            "Password reset request failed.",
            undefined,
            "ForgotPassword",
          );
          propose({ type: "REQUEST_ERROR", payload: error });
        },
      }),
    );
    await runClientPromise(requestEffect);
  }
};

const propose = (action: Action) => {
  update(action);
  void react(action);
};

export const ForgotPasswordView = (): ViewResult => {
  const handleSubmit = (e: Event) => {
    e.preventDefault();
    if (model.value.status === "loading") return;
    propose({ type: "REQUEST_START" });
  };

  return {
    template: html`
      <div class="flex min-h-screen items-center justify-center bg-gray-100">
        <div class="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
          <h2 class="mb-6 text-center text-2xl font-bold">Forgot Password</h2>
          ${model.value.status === "success"
            ? html`<div class="text-center text-green-600">
                  ${model.value.message}
                </div>
                <div class="mt-4 text-center text-sm">
                  <a
                    href="/login"
                    @click=${(e: Event) => {
                      e.preventDefault();
                      navigate("/login");
                    }}
                    class="font-medium text-zinc-600 hover:text-zinc-500"
                    >Back to Login</a
                  >
                </div>`
            : html` <p class="mb-4 text-center text-sm text-zinc-600">
                  Enter your email address and we will send you a link to reset
                  your password.
                </p>
                <form @submit=${handleSubmit}>
                  <div class="mb-4">
                    <label
                      for="email"
                      class="block text-sm font-medium text-gray-700"
                      >Email</label
                    >
                    <input
                      type="email"
                      id="email"
                      .value=${model.value.email}
                      @input=${(e: Event) =>
                        propose({
                          type: "UPDATE_EMAIL",
                          payload: (e.target as HTMLInputElement).value,
                        })}
                      class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-zinc-500 sm:text-sm"
                      required
                    />
                  </div>
                  ${model.value.status === "error"
                    ? html`<div class="mb-4 text-sm text-red-500">
                        ${model.value.message}
                      </div>`
                    : nothing}
                  ${NotionButton({
                    children:
                      model.value.status === "loading"
                        ? "Sending..."
                        : "Send Reset Link",
                    type: "submit",
                    loading: model.value.status === "loading",
                  })}
                </form>
                <div class="mt-4 text-center text-sm">
                  <a
                    href="/login"
                    @click=${(e: Event) => {
                      e.preventDefault();
                      navigate("/login");
                    }}
                    class="font-medium text-zinc-600 hover:text-zinc-500"
                    >Back to Login</a
                  >
                </div>`}
        </div>
      </div>
    `,
  };
};
