// components/layouts/AppLayout.ts
import { html, type TemplateResult } from "lit-html";
import { navigate } from "../../lib/client/router";
import {
  authState,
  proposeAuthAction,
} from "../../lib/client/stores/authStore";
import { clientLog } from "../../lib/client/logger.client";
import { runClientUnscoped } from "../../lib/client/runtime";

interface Props {
  children: TemplateResult;
}

interface ViewResult {
  template: TemplateResult;
  cleanup?: () => void;
}

export const AppLayout = ({ children }: Props): ViewResult => {
  const onLogout = () => {
    if (authState.value.user) {
      runClientUnscoped(
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

  const handleNavClick = (e: MouseEvent) => {
    e.preventDefault();
    const path = (e.currentTarget as HTMLAnchorElement).pathname;
    runClientUnscoped(navigate(path));
  };

  return {
    template: html`
      <div class="min-h-screen bg-gray-50 text-gray-900">
        <header
          style="view-transition-name: main-header;"
          class="flex items-center justify-between bg-white p-4 shadow-md"
        >
          <a
            href="/"
            @click=${handleNavClick}
            class="text-2xl font-bold text-zinc-800"
            >NotesApp</a
          >
          <nav>
            <div class="flex items-center space-x-4">
              ${authState.value.status === "authenticated"
                ? html`
                    <span class="text-sm text-zinc-600">
                      Welcome, ${authState.value.user?.email}
                    </span>
                    <a
                      href="/"
                      @click=${handleNavClick}
                      class="text-zinc-600 hover:text-zinc-900"
                    >
                      Notes
                    </a>
                    <a
                      href="/profile"
                      @click=${handleNavClick}
                      class="text-zinc-600 hover:text-zinc-900"
                    >
                      Profile
                    </a>
                    <button
                      @click=${onLogout}
                      class="text-zinc-600 hover:text-zinc-900"
                    >
                      Logout
                    </button>
                  `
                : html`
                    <a
                      href="/login"
                      @click=${handleNavClick}
                      class="text-zinc-600 hover:text-zinc-900"
                    >
                      Login
                    </a>
                    <a
                      href="/signup"
                      @click=${handleNavClick}
                      class="text-zinc-600 hover:text-zinc-900"
                    >
                      Sign Up
                    </a>
                  `}
            </div>
          </nav>
        </header>
        <main class="p-4">${children}</main>
      </div>
    `,
  };
};
