// File: views/layouts/AppLayout.ts
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
            >
              Life IO
            </a>
            <div>
              ${auth.value.status === "authenticated"
                ? html`
                    <a
                      href="/profile"
                      @click=${(e: Event) => {
                        e.preventDefault();
                        navigate("/profile");
                      }}
                    >
                      Profile
                    </a>
                    <button @click=${onLogout}>Logout</button>
                  `
                : html`
                    <a
                      href="/login"
                      @click=${(e: Event) => {
                        e.preventDefault();
                        navigate("/login");
                      }}
                    >
                      Login
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
