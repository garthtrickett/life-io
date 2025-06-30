// File: ./components/pages/login-page.ts

import { html, type TemplateResult } from "lit-html";
import { signal } from "@preact/signals-core";
import { pipe, Effect, Exit, Cause } from "effect";
import { trpc } from "../../lib/client/trpc";
import { proposeAuthAction } from "../../lib/client/stores/authStore";
import { navigate } from "../../lib/client/router";
import { clientLog } from "../../lib/client/logger.client";
import styles from "./LoginView.module.css";
import type { User } from "../../types/generated/public/User";
import { NotionButton } from "../ui/notion-button"; // <-- 1. Import the new button component

// --- Types ---
interface ViewResult {
  template: TemplateResult;
  cleanup?: () => void;
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
  | { type: "LOGIN_START" }
  | { type: "LOGIN_SUCCESS"; payload: { sessionId: string; user: User } }
  | { type: "LOGIN_ERROR"; payload: string };

// --- Module-level state and logic ---
const model = signal<Model>({
  email: "",
  password: "",
  error: null,
  isLoading: false,
});

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
      Effect.tap((result) =>
        clientLog(
          "info",
          `User login successful.`,
          result.user.id,
          "LoginView",
        ),
      ),
    );

    const exit = await Effect.runPromiseExit(loginEffect);

    if (Exit.isSuccess(exit)) {
      propose({ type: "LOGIN_SUCCESS", payload: exit.value });
    } else {
      const error = Cause.squash(exit.cause);
      const errorMessage =
        error instanceof Error
          ? error.message
          : "An unknown error occurred during login.";
      propose({ type: "LOGIN_ERROR", payload: errorMessage });
    }
  }

  if (action.type === "LOGIN_SUCCESS") {
    const { sessionId, user } = action.payload;
    const expires = new Date();
    expires.setDate(expires.getDate() + 30);
    document.cookie = `session_id=${sessionId}; path=/; expires=${expires.toUTCString()}; SameSite=Lax`;

    proposeAuthAction({
      type: "SET_AUTHENTICATED",
      payload: user,
    });
    navigate("/");
  }
};

const propose = (action: Action) => {
  update(action);
  void react(action);
};

// --- View Function ---
export const LoginView = (): ViewResult => {
  const handleLoginSubmit = (e: Event) => {
    e.preventDefault();
    if (model.value.isLoading) return;
    propose({ type: "LOGIN_START" });
  };

  return {
    template: html`
      <div class=${styles.container}>
        <div class=${styles.formWrapper}>
          <h2 class=${styles.title}>Login</h2>
          <form @submit=${handleLoginSubmit}>
            <div class=${styles.field}>
              <label for="email" class=${styles.label}>Email</label>
              <input
                type="email"
                id="email"
                class=${styles.input}
                .value=${model.value.email}
                @input=${(e: Event) =>
                  propose({
                    type: "UPDATE_EMAIL",
                    payload: (e.target as HTMLInputElement).value,
                  })}
                required
              />
            </div>
            <div class=${styles.field}>
              <label for="password" class=${styles.label}>Password</label>
              <input
                type="password"
                id="password"
                class=${styles.input}
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
              ? html`
                  <div class=${styles.errorText}>${model.value.error}</div>
                `
              : ""}
            ${NotionButton({
              children: model.value.isLoading ? "Logging in..." : "Login",
              type: "submit",
              loading: model.value.isLoading,
              onClick: handleLoginSubmit,
            })}
          </form>
          <div class=${styles.linkContainer}>
            <a href="/signup" class=${styles.link}>
              Don't have an account? Sign up.
            </a>
          </div>
        </div>
      </div>
    `,
  };
};
