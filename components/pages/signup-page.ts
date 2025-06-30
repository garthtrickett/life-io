// File: ./components/pages/signup-page.ts
import { html, type TemplateResult, nothing } from "lit-html";
import { signal } from "@preact/signals-core";
import { pipe, Effect, Exit, Cause } from "effect";
import { trpc } from "../../lib/client/trpc";
import { clientLog } from "../../lib/client/logger.client";
import { NotionButton } from "../ui/notion-button";
import { runClientPromise, runClientUnscoped } from "../../lib/client/runtime";
import { navigate } from "../../lib/client/router";

// --- Types ---
interface ViewResult {
  template: TemplateResult;
}
interface Model {
  email: string;
  password: string;
  error: string | null;
  isLoading: boolean;
}
type Action =
  | { type: "UPDATE_EMAIL"; payload: string }
  | { type: "UPDATE_PASSWORD"; payload: string }
  | { type: "SIGNUP_START" }
  | { type: "SIGNUP_SUCCESS"; payload: { success: boolean; email: string } }
  | { type: "SIGNUP_ERROR"; payload: string };

// --- State ---
const model = signal<Model>({
  email: "",
  password: "",
  error: null,
  isLoading: false,
});

// --- Update (State Reducer) ---
const update = (action: Action) => {
  switch (action.type) {
    case "UPDATE_EMAIL":
      model.value = { ...model.value, email: action.payload, error: null };
      break;
    case "UPDATE_PASSWORD":
      model.value = { ...model.value, password: action.payload, error: null };
      break;
    case "SIGNUP_START":
      model.value = { ...model.value, isLoading: true, error: null };
      break;
    case "SIGNUP_SUCCESS":
      model.value = { ...model.value, isLoading: false };
      break;
    case "SIGNUP_ERROR":
      model.value = {
        ...model.value,
        isLoading: false,
        error: action.payload,
      };
      break;
  }
};

// --- React (Side Effects) ---
const react = async (action: Action) => {
  if (action.type === "SIGNUP_START") {
    const signupEffect = pipe(
      Effect.tryPromise({
        try: () =>
          trpc.auth.signup.mutate({
            email: model.value.email,
            password: model.value.password,
          }),
        catch: (err) =>
          new Error(err instanceof Error ? err.message : String(err)),
      }),
    );

    const exit = await runClientPromise(Effect.exit(signupEffect));

    if (Exit.isSuccess(exit)) {
      propose({ type: "SIGNUP_SUCCESS", payload: exit.value });
    } else {
      const error = Cause.squash(exit.cause);
      const errorMessage =
        error instanceof Error
          ? error.message
          : "An unknown error occurred during signup.";
      propose({ type: "SIGNUP_ERROR", payload: errorMessage });
    }
  }
  if (action.type === "SIGNUP_SUCCESS") {
    runClientUnscoped(
      clientLog(
        "info",
        `Signup success for ${action.payload.email}. Navigating to /check-email.`,
        undefined,
        "SignupView:react",
      ),
    );
    navigate("/check-email");
  }
};

// --- Propose (Action Dispatcher) ---
const propose = (action: Action) => {
  update(action);
  void react(action);
};

// --- View ---
export const SignupView = (): ViewResult => {
  const handleSignupSubmit = (e: Event) => {
    e.preventDefault();
    if (model.value.isLoading) return;
    propose({ type: "SIGNUP_START" });
  };

  return {
    template: html`
      <div class="flex min-h-screen items-center justify-center bg-gray-100">
        <div class="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
          <h2 class="mb-6 text-center text-2xl font-bold">Create Account</h2>
          <form @submit=${handleSignupSubmit}>
            <div class="mb-4">
              <label for="email" class="block text-sm font-medium text-gray-700"
                >Email</label
              >
              <input
                type="email"
                id="email"
                class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-zinc-500 sm:text-sm"
                .value=${model.value.email}
                @input=${(e: Event) =>
                  propose({
                    type: "UPDATE_EMAIL",
                    payload: (e.target as HTMLInputElement).value,
                  })}
                required
              />
            </div>
            <div class="mb-6">
              <label
                for="password"
                class="block text-sm font-medium text-gray-700"
              >
                Password (min. 8 characters)
              </label>
              <input
                type="password"
                id="password"
                class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-zinc-500 sm:text-sm"
                .value=${model.value.password}
                @input=${(e: Event) =>
                  propose({
                    type: "UPDATE_PASSWORD",
                    payload: (e.target as HTMLInputElement).value,
                  })}
                required
              />
            </div>
            ${model.value.error
              ? html`<div class="mb-4 text-sm text-red-500">
                  ${model.value.error}
                </div>`
              : nothing}
            ${NotionButton({
              children: model.value.isLoading ? "Signing up..." : "Sign Up",
              type: "submit",
              loading: model.value.isLoading,
            })}
          </form>
          <div class="mt-4 text-center text-sm">
            <a
              href="/login"
              class="font-medium text-zinc-600 hover:text-zinc-500"
              @click=${(e: Event) => {
                e.preventDefault();
                navigate("/login");
              }}
            >
              Already have an account? Log in.
            </a>
          </div>
        </div>
      </div>
    `,
  };
};
