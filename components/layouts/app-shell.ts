// FILE: components/layouts/app-shell.ts
import "urlpattern-polyfill";
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Router } from "@lit-labs/router";
import { authStore, type AuthModel } from "../../lib/client/stores/authStore";
import { navigate } from "../../lib/client/router.ts";
import { clientLog } from "../../lib/client/logger.client.ts";
import { Effect } from "effect";
import { effect } from "@preact/signals-core"; // --- CHANGE: Import `effect`

// Import layouts and pages
import "./main-layout.ts";
import "../pages/notes-list-page.ts";
import "../pages/note-detail-page.ts";
import "../pages/login-page.ts";
import "../pages/signup-page.ts";

// --- SAM (State-Action-Model) Pattern Definition ---

interface Model {
  auth: AuthModel;
  isRedirecting: boolean;
}

type Action =
  | { type: "AUTH_STATE_CHANGED"; payload: AuthModel }
  | { type: "ROUTING_CHECK_START" }
  | { type: "ROUTING_REDIRECT_NEEDED"; payload: string }
  | { type: "ROUTING_COMPLETE" }
  | { type: "LOGOUT_BUTTON_CLICKED" };

const update = (model: Model, action: Action): Model => {
  switch (action.type) {
    case "AUTH_STATE_CHANGED":
      return { ...model, auth: action.payload };
    case "ROUTING_CHECK_START":
      return model;
    case "ROUTING_REDIRECT_NEEDED":
      return { ...model, isRedirecting: true };
    case "ROUTING_COMPLETE":
      return { ...model, isRedirecting: false };
    case "LOGOUT_BUTTON_CLICKED":
      return model;
    default:
      return model;
  }
};

@customElement("app-shell")
export class AppShell extends LitElement {
  private router = new Router(this, [
    {
      path: "/",
      name: "home",
      render: () => html`<dashboard-page></dashboard-page>`,
    },
    {
      path: "/login",
      name: "login",
      render: () => html`<login-page></login-page>`,
    },
    {
      path: "/signup",
      name: "signup",
      render: () => html`<signup-page></signup-page>`,
    },
    {
      path: "/notes/:id",
      name: "note-detail",
      render: ({ id }: any) =>
        html`<note-detail-page .noteId=${id}></note-detail-page>`,
    },
    {
      path: "/*",
      name: "not-found",
      render: () => html`<h1>404 - Not Found</h1>`,
    },
  ]);

  @state()
  private _model: Model = {
    auth: authStore.state,
    isRedirecting: false,
  };

  private _unsubscribeFromAuthStore?: () => void;

  connectedCallback(): void {
    super.connectedCallback();
    this.router.hostConnected();
    Effect.runPromise(
      clientLog(
        "info",
        "AppShell connected to DOM.",
        undefined,
        "AppShell:lifecycle",
      ),
    );

    window.addEventListener(
      "navigate-to",
      this._handleNavigateTo as EventListener,
    );

    // --- CHANGE: Use `effect` to subscribe to the signal directly.
    // This removes the "double subscription" and is more idiomatic.
    this._unsubscribeFromAuthStore = effect(() => {
      // By reading the signal's value here, we create a subscription.
      // This function will re-run whenever the auth state changes.
      const newAuthState = authStore.stateSignal.value;

      Effect.runPromise(
        clientLog(
          "debug",
          `Auth signal changed to: ${newAuthState.status}. Proposing state change.`,
          newAuthState.user?.id,
          "AppShell:authEffect",
        ),
      );

      // Propose an action to this component's internal state machine.
      this.propose({ type: "AUTH_STATE_CHANGED", payload: newAuthState });
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.router.hostDisconnected();
    Effect.runPromise(
      clientLog(
        "info",
        "AppShell disconnected from DOM, cleaning up.",
        undefined,
        "AppShell:lifecycle",
      ),
    );
    window.removeEventListener(
      "navigate-to",
      this._handleNavigateTo as EventListener,
    );
    // This now correctly calls the disposer function returned by `effect`.
    this._unsubscribeFromAuthStore?.();
  }

  private propose(action: Action) {
    Effect.runPromise(
      clientLog(
        "debug",
        `Proposing action: ${action.type}`,
        this._model.auth.user?.id,
        "AppShell:propose",
      ),
    );
    this._model = update(this._model, action);
    this.react(this._model, action);
  }

  private async react(model: Model, action: Action) {
    this.requestUpdate();
    Effect.runPromise(
      clientLog(
        "debug",
        `Reacting to action: ${action.type}`,
        model.auth.user?.id,
        "AppShell:react",
      ),
    );

    switch (action.type) {
      case "AUTH_STATE_CHANGED":
        Effect.runPromise(
          clientLog(
            "info",
            "Auth state changed, triggering a new routing check.",
            model.auth.user?.id,
            "AppShell:react",
          ),
        );
        this.propose({ type: "ROUTING_CHECK_START" });
        break;

      case "ROUTING_CHECK_START": {
        const { isRedirecting, auth } = model;
        const currentPath = window.location.pathname;
        Effect.runPromise(
          clientLog(
            "info",
            `Routing check started. Path: '${currentPath}', Auth: '${auth.status}', Redirecting: ${isRedirecting}`,
            auth.user?.id,
            "AppShell:react:routing",
          ),
        );

        if (isRedirecting) {
          Effect.runPromise(
            clientLog(
              "warn",
              "Skipping routing check; a redirect is already in progress.",
              auth.user?.id,
              "AppShell:react:routing",
            ),
          );
          return;
        }

        if (
          auth.status === "initializing" ||
          auth.status === "authenticating"
        ) {
          Effect.runPromise(
            clientLog(
              "debug",
              "Skipping routing check; auth state is not settled.",
              auth.user?.id,
              "AppShell:react:routing",
            ),
          );
          return;
        }

        const isPublicOnlyRoute = ["/login", "/signup"].includes(currentPath);
        let needsRedirectTo: string | null = null;

        if (auth.status === "unauthenticated" && !isPublicOnlyRoute) {
          needsRedirectTo = "/login";
        } else if (auth.status === "authenticated" && isPublicOnlyRoute) {
          needsRedirectTo = "/";
        }

        if (needsRedirectTo && currentPath !== needsRedirectTo) {
          Effect.runPromise(
            clientLog(
              "info",
              `Redirect needed from '${currentPath}' to '${needsRedirectTo}'. Proposing ROUTING_REDIRECT_NEEDED.`,
              auth.user?.id,
              "AppShell:react:routing",
            ),
          );
          this.propose({
            type: "ROUTING_REDIRECT_NEEDED",
            payload: needsRedirectTo,
          });
        } else {
          Effect.runPromise(
            clientLog(
              "debug",
              "Routing check complete, no redirect needed.",
              auth.user?.id,
              "AppShell:react:routing",
            ),
          );
        }
        break;
      }

      case "ROUTING_REDIRECT_NEEDED":
        Effect.runPromise(
          clientLog(
            "info",
            `Executing redirect navigation to '${action.payload}'.`,
            model.auth.user?.id,
            "AppShell:react",
          ),
        );
        navigate(action.payload);
        break;

      case "LOGOUT_BUTTON_CLICKED":
        Effect.runPromise(
          clientLog(
            "info",
            "Logout button clicked, delegating to authStore.",
            model.auth.user?.id,
            "AppShell:react",
          ),
        );
        authStore.logout();
        break;
    }
  }

  private _handleNavigateTo = (e: CustomEvent<{ path: string }>) => {
    const path = e.detail.path;
    Effect.runPromise(
      clientLog(
        "info",
        `Handling 'navigate-to' event for path: ${path}`,
        undefined,
        "AppShell:navigate",
      ),
    );

    if (window.location.pathname === path) {
      Effect.runPromise(
        clientLog(
          "warn",
          "Navigation skipped; already at the target path.",
          undefined,
          "AppShell:navigate",
        ),
      );
      return;
    }

    const performNavigation = () => {
      window.history.pushState({}, "", path);
      this.router.goto(path);
      this.propose({ type: "ROUTING_COMPLETE" });
    };

    if (!(document as any).startViewTransition) {
      Effect.runPromise(
        clientLog(
          "debug",
          "No View Transition API found. Navigating directly.",
          undefined,
          "AppShell:navigate",
        ),
      );
      performNavigation();
      return;
    }

    Effect.runPromise(
      clientLog(
        "debug",
        "Starting view transition.",
        undefined,
        "AppShell:navigate",
      ),
    );
    const transition = (document as any).startViewTransition(performNavigation);
    transition.ready.then(() =>
      document.documentElement.classList.add("is-transitioning"),
    );
    transition.finished.then(() => {
      document.documentElement.classList.remove("is-transitioning");
    });
  };

  createRenderRoot() {
    return this;
  }

  render() {
    // This now reads the local `_model`, which is kept in sync by the `effect`.
    const { status } = this._model.auth;

    Effect.runPromise(
      clientLog(
        "debug",
        `Rendering AppShell with auth status: ${status}`,
        this._model.auth.user?.id,
        "AppShell:render",
      ),
    );

    if (status === "initializing" || status === "authenticating") {
      return html`<div
        class="fixed inset-0 bg-gray-100 flex items-center justify-center z-50"
      >
        <div
          class="w-12 h-12 border-4 border-zinc-300 border-t-zinc-600 rounded-full animate-spin"
        ></div>
      </div>`;
    }

    return html`
      <main-layout>
        <div slot="header">
          <nav class="container mx-auto p-4 flex items-center justify-between">
            <a href="/" class="text-xl font-bold text-zinc-900">Life IO</a>
            <div>
              ${status === "authenticated"
                ? html`
                    <a
                      href="/"
                      class="px-3 py-2 text-zinc-600 hover:text-zinc-900"
                      >Notes</a
                    >
                    <button
                      @click=${() =>
                        this.propose({ type: "LOGOUT_BUTTON_CLICKED" })}
                      class="px-3 py-2 text-zinc-600 hover:text-zinc-900"
                    >
                      Logout
                    </button>
                  `
                : html`<a
                    href="/login"
                    class="px-3 py-2 text-zinc-600 hover:text-zinc-900"
                    >Login</a
                  >`}
            </div>
          </nav>
        </div>
        ${this.router.outlet()}
      </main-layout>
    `;
  }
}
