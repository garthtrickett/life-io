// File: ./components/layouts/app-shell.ts
// REVISED: The router now uses the native View Transitions API for page navigation.
import "urlpattern-polyfill";
import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { Router } from "@lit-labs/router";

// Import layouts and pages
import "./main-layout.ts";
import "../pages/notes-list-page.ts";
import "../pages/note-detail-page.ts";

interface RouterRequestEvent extends CustomEvent {
  detail: {
    path: string;
    replace?: boolean;
  };
}

@customElement("app-shell")
export class AppShell extends LitElement {
  constructor() {
    super();
    this.addEventListener("lit-router-request", this._onRouterRequest);
  }

  createRenderRoot() {
    return this;
  }

  private router = new Router(this, [
    { path: "/", render: () => html`<dashboard-page></dashboard-page>` },
    {
      path: "/notes/:id",
      render: ({ id }) =>
        html`<note-detail-page .noteId=${id}></note-detail-page>`,
    },
    {
      path: "/dashboard",
      render: () => html`<dashboard-page></dashboard-page>`,
    },
    { path: "/*", render: () => html`<h1>404 - Page Not Found</h1>` },
  ]);

  // --- NEW: Implements View Transitions API for navigation ---
  private _onRouterRequest = async (e: Event) => {
    const event = e as RouterRequestEvent;
    event.preventDefault();

    // Check if the browser supports the View Transitions API
    if (!(document as any).startViewTransition) {
      // Fallback for older browsers
      this.router.goto(event.detail.path);
      return;
    }

    // Perform the transition
    const transition = (document as any).startViewTransition(() => {
      this.router.goto(event.detail.path);
      // The router update is captured here, and the DOM changes are animated
    });

    // Optional: Add classes to the document root for custom animations
    transition.ready.then(() => {
      document.documentElement.classList.add("is-transitioning");
    });

    transition.finished.then(() => {
      document.documentElement.classList.remove("is-transitioning");
    });
  };

  render() {
    return html`
      <main-layout>
        <div slot="header">
          <nav class="container mx-auto p-4 flex items-center justify-between">
            <a href="/" class="text-xl font-bold text-zinc-900">Life IO</a>
            <div>
              <a href="/" class="px-3 py-2 text-zinc-600 hover:text-zinc-900"
                >Notes</a
              >
            </div>
          </nav>
        </div>
        ${this.router.outlet()}
      </main-layout>
    `;
  }
}
