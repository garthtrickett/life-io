// components/pages/signup-page.ts
import { html, type TemplateResult, nothing } from "lit-html";
import { signal } from "@preact/signals-core";
import { pipe, Effect, Exit, Cause } from "effect";
import { trpc } from "../../lib/client/trpc";
import { proposeAuthAction } from "../../lib/client/stores/authStore";
import { clientLog } from "../../lib/client/logger.client";
import styles from "./SignupView.module.css";
import type { User } from "../../types/generated/public/User";
import { NotionButton } from "../ui/notion-button";
import { runClientPromise, runClientUnscoped } from "../../lib/client/runtime";

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
  | { type: "SIGNUP_START" }
  | { type: "SIGNUP_SUCCESS"; payload: { sessionId: string; user: User } }
  | { type: "SIGNUP_ERROR"; payload: string };

const model = signal<Model>({
  email: "",
  password: "",
  error: null,
  isLoading: false,
});

const update = (action: Action) => {
  // ... (update logic remains unchanged)
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
      Effect.tap((result) =>
        Effect.forkDaemon(
          clientLog(
            "info",
            `User signup successful, setting auth state.`,
            result.user.id,
            "SignupView",
          ),
        ),
      ),
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
    const { sessionId, user } = action.payload;
    const expires = new Date();
    expires.setDate(expires.getDate() + 30);
    document.cookie = `session_id=${sessionId}; path=/; expires=${expires.toUTCString()}; SameSite=Lax`;

    proposeAuthAction({
      type: "SET_AUTHENTICATED",
      payload: user,
    });
  }
};

const propose = (action: Action) => {
  runClientUnscoped(
    clientLog(
      "debug",
      `SignupView: Proposing action ${action.type}`,
      undefined,
      "SignupView:propose",
    ),
  );
  update(action);
  void react(action);
};

export const SignupView = (): ViewResult => {
  const handleSignupSubmit = (e: Event) => {
    e.preventDefault();
    if (model.value.isLoading) return;
    propose({ type: "SIGNUP_START" });
  };

  return {
    template: html`
      <div class=${styles.container}>
        <div class=${styles.formWrapper}>
          <h2 class=${styles.title}>Create Account</h2>
          <form @submit=${handleSignupSubmit}>
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
              <label for="password" class=${styles.label}>
                Password (min. 8 characters)
              </label>
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
              ? html`<div class=${styles.errorText}>${model.value.error}</div>`
              : nothing}
            ${NotionButton({
              children: model.value.isLoading ? "Signing up..." : "Sign Up",
              type: "submit",
              loading: model.value.isLoading,
              onClick: handleSignupSubmit,
            })}
          </form>
          <div class=${styles.linkContainer}>
            <a href="/login" class=${styles.link}>
              Already have an account? Log in.
            </a>
          </div>
        </div>
      </div>
    `,
  };
};
