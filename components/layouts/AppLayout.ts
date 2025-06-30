// File: components/layouts/AppLayout.ts
import { html, type TemplateResult } from "lit-html";
import {
  authState,
  proposeAuthAction,
} from "../../lib/client/stores/authStore";
import { signal } from "@preact/signals-core";
import { clientLog } from "../../lib/client/logger.client";
import { runClientEffect } from "../../lib/client/runtime";

interface Props {
  children: TemplateResult;
}

interface ViewResult {
  template: TemplateResult;
  cleanup?: () => void;
}

export const AppLayout = ({ children }: Props): ViewResult => {
  const auth = signal(authState.value);
  const cleanup = authState.subscribe(
    (newAuthState) => (auth.value = newAuthState),
  );

  const onLogout = () => {
    if (authState.value.user) {
      runClientEffect(
        clientLog(
          "info",
          "User clicked logout, proposing LOGOUT_START action.",
          authState.value.user.id,
          "AppLayout:onLogout",
        ),
      );
      proposeAuthAction({ type: "LOGOUT_START" });
    }
  };

  return {
    template: html`
      <div class="min-h-screen bg-gray-50 text-gray-900">
        <header
          class="flex items-center justify-between bg-white p-4 shadow-md"
        >
          <a href="/" class="text-2xl font-bold text-zinc-800">NotesApp</a>
          <nav>
            <div class="flex items-center space-x-4">
              ${auth.value.status === "authenticated"
                ? html`
                    <span class="text-sm text-zinc-600"
                      >Welcome, ${auth.value.user?.email}</span
                    >
                    <a href="/" class="text-zinc-600 hover:text-zinc-900"
                      >Notes</a
                    >
                    <a href="/profile" class="text-zinc-600 hover:text-zinc-900"
                      >Profile</a
                    >
                    <button
                      @click=${onLogout}
                      class="text-zinc-600 hover:text-zinc-900"
                    >
                      Logout
                    </button>
                  `
                : html`
                    <a href="/login" class="text-zinc-600 hover:text-zinc-900"
                      >Login</a
                    >
                    <a href="/signup" class="text-zinc-600 hover:text-zinc-900"
                      >Sign Up</a
                    >
                  `}
            </div>
          </nav>
        </header>
        <main class="p-4">${children}</main>
      </div>
    `,
    cleanup,
  };
};
