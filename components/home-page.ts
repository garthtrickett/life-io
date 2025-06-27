// File: ./components/home-page.ts

import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("home-page")
export class HomePage extends LitElement {
  // Disabling shadow DOM allows for simpler global styling if needed,
  // but for this component, we'll use inline styles for simplicity.
  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div style="padding: 2rem; max-width: 42rem; margin: auto;">
        <div
          style="border: 1px solid #e5e7eb; padding: 1.5rem; border-radius: 0.5rem; background-color: #18181b; color: #fafafa;"
        >
          <h2 style="font-size: 1.5rem; font-weight: 600;">
            Welcome to Life IO
          </h2>
          <p style="margin-top: 0.5rem; font-size: 1.125rem; color: #a1a1aa;">
            This is a simple application to demonstrate a modern tech stack
            using ElysiaJS, tRPC, Effect-TS, and Lit.
          </p>

          <div style="text-align: right; padding-top: 1rem;">
            <a
              href="/create"
              style="display: inline-block; padding: 0.5rem 1rem; background-color: #3f3f46; color: #fafafa; text-decoration: none; border-radius: 0.375rem;"
            >
              Create a Note
            </a>
          </div>
        </div>
      </div>
    `;
  }
}
