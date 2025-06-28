// File: ./components/home-page.ts
import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import "./notion-button-a11y.ts"; // Import the unified button

@customElement("home-page")
export class HomePage extends LitElement {
  // Disabling shadow DOM is already done, which is good for this setup.
  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div class="max-w-2xl mx-auto mt-6">
        <div class="bg-white border border-zinc-200 rounded-lg p-8">
          <h2 class="text-2xl font-bold text-zinc-900">Welcome to Life IO</h2>
          <p class="mt-2 text-lg text-zinc-600">
            This is a simple application to demonstrate a modern tech stack
            using ElysiaJS, tRPC, Effect-TS, and Lit.
          </p>
          <div class="text-right pt-4">
            <notion-button href="/create"> Create a Note </notion-button>
          </div>
        </div>
      </div>
    `;
  }
}
