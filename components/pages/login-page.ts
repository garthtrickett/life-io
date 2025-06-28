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
    this.react(this._model, action);
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
          catch: (err: any) => new Error(err.message),
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

      Effect.runPromise(
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

      Effect.runPromise(
        clientLog(
          "info",
          `Login successful. Programmatically navigating to '/'.`,
          action.payload.user.id,
          "LoginPage",
        ),
      );
      navigate("/"); // Redirect to home page on success
    }
  }

  render() {
    if (this._model.isLoading) {
      return html`
        <div
          class="fixed inset-0 bg-gray-100 flex items-center justify-center z-50"
        >
          <div
            class="w-12 h-12 border-4 border-zinc-300 border-t-zinc-600 rounded-full animate-spin"
          ></div>
        </div>
      `;
    }

    return html`
      <div class="flex items-center justify-center min-h-screen bg-gray-100">
        <div class="p-8 bg-white rounded-lg shadow-md w-full max-w-md">
          <h2 class="text-2xl font-bold text-center mb-6">Login</h2>
          <form @submit=${(e: Event) => e.preventDefault()}>
            <div class="mb-4">
              <label for="email" class="block text-sm font-medium text-gray-700"
                >Email</label
              >
              <input
                type="email"
                id="email"
                .value=${this._model.email}
                @input=${(e: any) =>
                  this.propose({
                    type: "UPDATE_EMAIL",
                    payload: e.target.value,
                  })}
                class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-zinc-500 focus:border-zinc-500 sm:text-sm"
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
                .value=${this._model.password}
                @input=${(e: any) =>
                  this.propose({
                    type: "UPDATE_PASSWORD",
                    payload: e.target.value,
                  })}
                class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-zinc-500 focus:border-zinc-500 sm:text-sm"
                required
              />
            </div>
            ${this._model.error
              ? html`<div class="text-red-500 text-sm mb-4">
                  ${this._model.error}
                </div>`
              : ""}
            <notion-button
              type="submit"
              .loading=${this._model.isLoading}
              @notion-button-click=${() => {
                this.propose({ type: "LOGIN_START" });
              }}
            >
              Login
            </notion-button>
          </form>
          <div class="text-center mt-4 text-sm">
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
