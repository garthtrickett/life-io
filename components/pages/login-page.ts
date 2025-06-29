// FILE: components/pages/login-page.ts
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

// Model and Action types remain the same...
interface Model {
  email: string;
  password: string;
  error: string | null;
  isLoading: boolean;
}

type Action =
  | { type: "UPDATE_EMAIL"; payload: string }
  | { type: "UPDATE_PASSWORD"; payload: string }
  | { type: "LOGIN_START" }
  | { type: "LOGIN_SUCCESS"; payload: { sessionId: string; user: User } }
  | { type: "LOGIN_ERROR"; payload: string };

const update = (model: Model, action: Action): Model => {
  switch (action.type) {
    case "UPDATE_EMAIL":
      return { ...model, email: action.payload, error: null };
    case "UPDATE_PASSWORD":
      return { ...model, password: action.payload, error: null };
    case "LOGIN_START":
      return { ...model, isLoading: true, error: null };
    case "LOGIN_SUCCESS":
      return { ...model, isLoading: false };
    case "LOGIN_ERROR":
      return { ...model, isLoading: false, error: action.payload };
    default:
      return model;
  }
};

@customElement("login-page")
export class LoginPage extends PageAnimationMixin(LitElement) {
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
    void this.react(this._model, action);
  }

  private async react(model: Model, action: Action) {
    this.requestUpdate();

    if (action.type === "LOGIN_START") {
      const loginEffect = pipe(
        Effect.tryPromise({
          try: () =>
            trpc.auth.login.mutate({
              email: model.email,
              password: model.password,
            }),
          catch: (err: unknown) => new Error(String(err)),
        }),
        Effect.match({
          onSuccess: (result) =>
            this.propose({ type: "LOGIN_SUCCESS", payload: result }),
          onFailure: (error) =>
            this.propose({ type: "LOGIN_ERROR", payload: error.message }),
        }),
      );
      await Effect.runPromise(loginEffect);
    }

    if (action.type === "LOGIN_SUCCESS") {
      const expires = new Date();
      expires.setDate(expires.getDate() + 30);
      document.cookie = `session_id=${
        action.payload.sessionId
      }; path=/; expires=${expires.toUTCString()}; SameSite=Lax`;

      runClientEffect(
        clientLog(
          "info",
          `User login successful, setting auth state.`,
          action.payload.user.id,
          "LoginPage",
        ),
      );

      authStore.propose({
        type: "SET_AUTHENTICATED",
        payload: action.payload.user,
      });

      runClientEffect(
        clientLog(
          "info",
          `Login successful. Programmatically navigating to '/'.`,
          action.payload.user.id,
          "LoginPage",
        ),
      );
      navigate("/");
    }
  }

  private _handleLoginSubmit(e: Event) {
    e.preventDefault();
    if (this._model.isLoading) return;
    this.propose({ type: "LOGIN_START" });
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
          <h2 class="mb-6 text-center text-2xl font-bold">Login</h2>
          <form @submit=${this._handleLoginSubmit}>
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
                Password
              </label>
              <input
                type="password"
                id="password"
                .value=${this._model.password}
                @input=${(e: Event) =>
                  this.propose({
                    type: "UPDATE_PASSWORD",
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
              class="relative w-full"
              .loading=${this._model.isLoading}
            >
              <!-- FIX: Add the Tailwind classes directly to the button -->
              <button
                type="submit"
                ?disabled=${this._model.isLoading}
                class="inline-flex w-full items-center justify-center gap-2 rounded-md bg-zinc-800 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:bg-zinc-600"
              >
                <span
                  class="${this._model.isLoading ? "text-transparent" : ""}"
                >
                  Login
                </span>
              </button>
            </notion-button>
          </form>
          <div class="mt-4 text-center text-sm">
            <a
              href="/signup"
              class="font-medium text-zinc-600 hover:text-zinc-500"
            >
              Don't have an account? Sign up.
            </a>
          </div>
        </div>
      </div>
    `;
  }
}
