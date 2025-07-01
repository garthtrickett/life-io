// File: ./components/pages/login-page.ts
import { html, type TemplateResult, nothing } from "lit-html";
import { signal } from "@preact/signals-core";
import { pipe, Effect, Exit, Cause } from "effect";
import { trpc } from "../../lib/client/trpc";
import { proposeAuthAction } from "../../lib/client/stores/authStore";
import { NotionButton } from "../ui/notion-button";
import { runClientPromise } from "../../lib/client/runtime";
import { navigate } from "../../lib/client/router";
import { User } from "../../types/generated/public/User";

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
interface LoginSuccessPayload {
  sessionId: string;
  user: User;
}

type Action =
  | { type: "UPDATE_EMAIL"; payload: string }
  | { type: "UPDATE_PASSWORD"; payload: string }
  | { type: "LOGIN_START" }
  | { type: "LOGIN_SUCCESS"; payload: LoginSuccessPayload }
  | { type: "LOGIN_ERROR"; payload: string };

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
    case "LOGIN_START":
      model.value = { ...model.value, isLoading: true, error: null };
      break;
    case "LOGIN_SUCCESS":
      model.value = { ...model.value, isLoading: false };
      break;
    case "LOGIN_ERROR":
      model.value = { ...model.value, isLoading: false, error: action.payload };
      break;
  }
};
// --- React (Side Effects) ---
const react = async (action: Action) => {
  if (action.type === "LOGIN_START") {
    const loginEffect = pipe(
      Effect.tryPromise({
        try: () =>
          trpc.auth.login.mutate({
            email: model.value.email,
            password: model.value.password,
          }),
        catch: (err) =>
          new Error(err instanceof Error ? err.message : String(err)),
      }),
    );

    const exit = await runClientPromise(Effect.exit(loginEffect));

    if (Exit.isSuccess(exit)) {
      propose({
        type: "LOGIN_SUCCESS",
        /*  we know what the router returns; assert it
            (or add a type parameter to loginEffect)   */
        payload: exit.value as LoginSuccessPayload,
      });
    } else {
      const error = Cause.squash(exit.cause);
      // --- FIX START ---
      const errorMessage =
        error instanceof Error ? error.message : "An unknown error occurred.";
      propose({ type: "LOGIN_ERROR", payload: errorMessage });
      // --- FIX END ---
    }
  }

  if (action.type === "LOGIN_SUCCESS") {
    const { sessionId, user } = action.payload;
    const expires = new Date();
    expires.setDate(expires.getDate() + 30);
    document.cookie = `session_id=${sessionId}; path=/; expires=${expires.toUTCString()}; SameSite=Lax`;

    proposeAuthAction({ type: "SET_AUTHENTICATED", payload: user });
  }
};

// --- Propose (Action Dispatcher) ---
const propose = (action: Action) => {
  update(action);
  void react(action);
};

// --- View ---
export const LoginView = (): ViewResult => {
  const handleLoginSubmit = (e: Event) => {
    e.preventDefault();
    propose({ type: "LOGIN_START" });
  };

  return {
    template: html`
      <div class="flex min-h-screen items-center justify-center bg-gray-100">
        <div class="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
          <h2 class="mb-6 text-center text-2xl font-bold">Login</h2>
          <form @submit=${handleLoginSubmit}>
            <div class="mb-4">
              <label for="email" class="block text-sm font-medium text-gray-700"
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
            <div class="mb-6">
              <label
                for="password"
                class="block text-sm font-medium text-gray-700"
                >Password</label
              >
              <input
                type="password"
                id="password"
                .value=${model.value.password}
                @input=${(e: Event) =>
                  propose({
                    type: "UPDATE_PASSWORD",
                    payload: (e.target as HTMLInputElement).value,
                  })}
                class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-zinc-500 sm:text-sm"
                required
              />
            </div>
            ${model.value.error
              ? html`<div class="mb-4 text-sm text-red-500">
                  ${model.value.error}
                </div>`
              : nothing}
            ${NotionButton({
              children: model.value.isLoading ? "Logging in..." : "Login",
              type: "submit",
              loading: model.value.isLoading,
            })}
          </form>
          <div class="mt-4 text-center text-sm">
            <a
              href="/forgot-password"
              @click=${(e: Event) => {
                e.preventDefault();
                navigate("/forgot-password");
              }}
              class="font-medium text-zinc-500 hover:text-zinc-700"
            >
              Forgot your password?
            </a>
          </div>
          <div class="mt-2 text-center text-sm">
            <a
              href="/signup"
              class="font-medium text-zinc-600 hover:text-zinc-500"
              @click=${(e: Event) => {
                e.preventDefault();
                navigate("/signup");
              }}
            >
              Don't have an account? Sign up.
            </a>
          </div>
        </div>
      </div>
    `,
  };
};
