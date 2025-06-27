import "urlpattern-polyfill";
import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { Router } from "@lit-labs/router";
import "./home-page.ts";
import "./my-note-form.ts";

@customElement("life-io-app")
export class LifeIoApp extends LitElement {
  // Disable Shadow DOM to use global Tailwind styles
  createRenderRoot() {
    return this;
  }

  private router = new Router(this, [
    { path: "/", render: () => html`<home-page></home-page>` },
    { path: "/create", render: () => html`<my-note-form></my-note-form>` },
  ]);

  render() {
    return html`
      <body class="bg-zinc-50 text-zinc-900 font-sans">
        <header class="bg-white border-b border-zinc-200">
          <nav class="container mx-auto p-4 flex items-center justify-between">
            <a href="/" class="text-xl font-bold text-zinc-900">Life IO</a>
            <div>
              <a href="/" class="px-3 py-2 text-zinc-600 hover:text-zinc-900"
                >Home</a
              >
              <a
                href="/create"
                class="px-3 py-2 text-zinc-600 hover:text-zinc-900"
                >Create Note</a
              >
            </div>
          </nav>
        </header>
        <main class="flex-grow container mx-auto p-4">
          ${this.router.outlet()}
        </main>
      </body>
    `;
  }
}
