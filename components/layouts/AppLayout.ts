// File: ./components/layouts/AppLayout.ts
import { html, type TemplateResult } from "lit-html";
import {
  authState,
  proposeAuthAction,
} from "../../lib/client/stores/authStore";
import { useEffect } from "../../lib/client/lifecycle";
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

  // This effect hook handles routing decisions based on auth status.
  // It re-runs whenever the auth state changes (via the authState signal) or
  // when the route changes (which causes this component to re-render).
  useEffect(() => {
    auth.value = authState.value;

    const currentStatus = authState.value.status;
    const currentPath = window.location.pathname;

    // Don't do anything while we're still figuring out the auth state
    if (
      currentStatus === "initializing" ||
      currentStatus === "authenticating"
    ) {
      return;
    }

    const isPublicPath = ["/login", "/signup"].includes(currentPath);

    // If user is not logged in and is on a private page, redirect to login
    if (currentStatus === "unauthenticated" && !isPublicPath) {
      runClientEffect(
        clientLog(
          "info",
          `[Route Guard] Not authenticated on private path '${currentPath}'. Redirecting to /login.`,
          undefined,
          "AppLayout",
        ),
      );
      navigate("/login");
    }

    // If user is logged in and is on a public-only page, redirect to home
    if (currentStatus === "authenticated" && isPublicPath) {
      runClientEffect(
        clientLog(
          "info",
          `[Route Guard] Authenticated on public path '${currentPath}'. Redirecting to /.`,
          authState.value.user?.id,
          "AppLayout",
        ),
      );
      navigate("/");
    }
  }, auth);

  const onLogout = () => proposeAuthAction({ type: "LOGOUT_START" });

  // --- FIX START: Create a dedicated function to render navigation links ---
  const renderNavLinks = () => {
    const status = auth.value.status;

    // While the initial auth check is running, render a placeholder or nothing
    // to prevent the "Login" link from flashing. This is the key to the fix.
    if (status === "initializing" || status === "authenticating") {
      // Returning an empty template is the simplest way to prevent the flicker.
      return html``;
    }

    // Once the auth check is complete, render the correct links.
    if (status === "authenticated") {
      return html`
        <a
          href="/profile"
          @click=${(e: Event) => {
            e.preventDefault();
            navigate("/profile");
          }}
          class="px-3 py-2 text-zinc-600 hover:text-zinc-900"
        >
          Profile
        </a>
        <button
          @click=${onLogout}
          class="px-3 py-2 text-zinc-600 hover:text-zinc-900"
        >
          Logout
        </button>
      `;
    }

    // If unauthenticated, show the login link.
    return html`
      <a
        href="/login"
        @click=${(e: Event) => {
          e.preventDefault();
          navigate("/login");
        }}
        class="px-3 py-2 text-zinc-600 hover:text-zinc-900"
      >
        Login
      </a>
    `;
  };
  // --- FIX END ---

  return {
    template: html`
      <div class="min-h-screen bg-gray-50 text-gray-900">
        <header class="bg-white p-4 shadow-sm">
          <nav class="container mx-auto flex items-center justify-between">
            <a
              href="/"
              @click=${(e: Event) => {
                e.preventDefault();
                navigate("/");
              }}
              class="text-xl font-bold text-zinc-900"
            >
              Life IO
            </a>
            <div>${renderNavLinks()}</div>
          </nav>
        </header>
        <main class="p-4">${children}</main>
      </div>
    `,
  };
};
