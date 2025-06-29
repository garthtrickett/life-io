// File: components/layouts/AppLayout.ts
import { html, type TemplateResult } from "lit-html";
import { authState } from "../../lib/client/stores/authStore";
import { signal } from "@preact/signals-core";
import { navigate } from "../../lib/client/router";
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

  const onLogout = () =>
    authState.value.user &&
    runClientEffect(
      clientLog(
        "info",
        "User clicked logout.",
        authState.value.user.id,
        "AppLayout:onLogout",
      ),
    );

  return {
    template: html`
      <div class="min-h-screen bg-gray-50 text-gray-900">
        <header
          class="flex items-center justify-between bg-white p-4 shadow-md"
        >
          <a href="/" class="text-2xl font-bold text-zinc-800">NotesApp</a>
          <nav class="flex items-center space-x-4">
            ${auth.value.status === "authenticated"
              ? html`
                  <span class="text-sm text-zinc-600">
                    Welcome, ${auth.value.user?.email}
                  </span>
                  <a href="/profile" class="text-zinc-600 hover:text-zinc-900">
                    Profile
                  </a>
                  <button @click=${() => authState.value.user && onLogout()}>
                    Logout
                  </button>
                `
              : html`
                  <a href="/login" class="text-zinc-600 hover:text-zinc-900">
                    Login
                  </a>
                  <a href="/signup" class="text-zinc-600 hover:text-zinc-900">
                    Sign Up
                  </a>
                `}
          </nav>
        </header>
        <main class="p-4">${children}</main>
      </div>
    `,
    cleanup,
  };
};
