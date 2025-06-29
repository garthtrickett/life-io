// FILE: components/pages/signup-page.ts
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { PageAnimationMixin } from "../mixins/page-animation-mixin.ts";
import { trpc } from "../../lib/client/trpc";
import { pipe, Effect } from "effect";
import { authStore } from "../../lib/client/stores/authStore";
import type { User } from "../../types/generated/public/User";
import "../ui/notion-button-a11y.ts";
import { clientLog } from "../../lib/client/logger.client.ts";
import { navigate } from "../../lib/client/router.ts";
import { runClientEffect } from "../../lib/client/runtime.ts";

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
  | { type: "SIGNUP_SUCCESS"; payload: { sessionId: string; user: User } }
  | { type: "SIGNUP_ERROR"; payload: string };

const update = (model: Model, action: Action): Model => {
  switch (action.type) {
    case "UPDATE_EMAIL":
      return { ...model, email: action.payload, error: null };
    case "UPDATE_PASSWORD":
      return { ...model, password: action.payload, error: null };
    case "SIGNUP_START":
      return { ...model, isLoading: true, error: null };
    case "SIGNUP_SUCCESS":
      return { ...model, isLoading: false };
    case "SIGNUP_ERROR":
      return { ...model, isLoading: false, error: action.payload };
    default:
      return model;
  }
};

@customElement("signup-page")
export class SignupPage extends PageAnimationMixin(LitElement) {
  @state()
  private _model: Model = {
    email: "",
    password: "",
    error: null,
    isLoading: false,
  };

  createRenderRoot() {
    return this;
  }

  private propose(action: Action) {
    this._model = update(this._model, action);
    // FIX(no-floating-promises): The `react` method is async. Prepending `void`
    // explicitly marks this as a "fire-and-forget" call, satisfying the linter.
    void this.react(this._model, action);
  }

  private async react(model: Model, action: Action) {
    this.requestUpdate();

    if (action.type === "SIGNUP_START") {
      const signupEffect = pipe(
        Effect.tryPromise({
          try: () =>
            trpc.auth.signup.mutate({
              email: model.email,
              password: model.password,
            }),
          // FIX(no-explicit-any, unsafe-access): Type the caught error as `unknown`
          // and safely check if it's an Error instance before accessing `.message`.
          catch: (err: unknown) =>
            new Error(err instanceof Error ? err.message : String(err)),
        }),
        Effect.match({
          onSuccess: (result) =>
            this.propose({ type: "SIGNUP_SUCCESS", payload: result }),
          onFailure: (error) =>
            this.propose({ type: "SIGNUP_ERROR", payload: error.message }),
        }),
      );
      await Effect.runPromise(signupEffect);
    }

    if (action.type === "SIGNUP_SUCCESS") {
      const expires = new Date();
      expires.setDate(expires.getDate() + 30);
      document.cookie = `session_id=${
        action.payload.sessionId
      }; path=/; expires=${expires.toUTCString()}; SameSite=Lax`;

      runClientEffect(
        clientLog(
          "info",
          `User signup successful, setting auth state.`,
          action.payload.user.id,
          "SignupPage",
        ),
      );

      authStore.propose({
        type: "SET_AUTHENTICATED",
        payload: action.payload.user,
      });

      runClientEffect(
        clientLog(
          "info",
          `Signup successful. Programmatically navigating to '/'.`,
          action.payload.user.id,
          "SignupPage",
        ),
      );
      navigate("/"); // Redirect to home page on success
    }
  }

  render() {
    if (this._model.isLoading) {
      return html`
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-gray-100"
        >
          <div
            class="h-12 w-12 animate-spin rounded-full border-4 border-zinc-300 border-t-zinc-600"
          ></div>
        </div>
      `;
    }

    return html`
      <div class="flex min-h-screen items-center justify-center bg-gray-100">
        <div class="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
          <h2 class="mb-6 text-center text-2xl font-bold">Create Account</h2>
          <form @submit=${(e: Event) => e.preventDefault()}>
            <div class="mb-4">
              <label
                for="email"
                class="block text-sm font-medium text-gray-700"
              >
                Email
              </label>
              <input
                type="email"
                id="email"
                .value=${this._model.email}
                @input=${(e: Event) =>
                  this.propose({
                    type: "UPDATE_EMAIL",
                    // FIX(no-explicit-any, unsafe-access): Add type assertion for the event target.
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
              >
                Password (min. 8 characters)
              </label>
              <input
                type="password"
                id="password"
                .value=${this._model.password}
                @input=${(e: Event) =>
                  this.propose({
                    type: "UPDATE_PASSWORD",
                    // FIX(no-explicit-any, unsafe-access): Add type assertion for the event target.
                    payload: (e.target as HTMLInputElement).value,
                  })}
                class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-zinc-500 sm:text-sm"
                required
              />
            </div>
            ${this._model.error
              ? html`
                  <div class="mb-4 text-sm text-red-500">
                    ${this._model.error}
                  </div>
                `
              : ""}
            <notion-button
              type="submit"
              .loading=${this._model.isLoading}
              @notion-button-click=${() =>
                this.propose({ type: "SIGNUP_START" })}
            >
              Sign Up
            </notion-button>
          </form>
          <div class="mt-4 text-center text-sm">
            <a
              href="/login"
              class="font-medium text-zinc-600 hover:text-zinc-500"
            >
              Already have an account? Log in.
            </a>
          </div>
        </div>
      </div>
    `;
  }
}
