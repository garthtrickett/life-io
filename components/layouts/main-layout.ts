// File: ./components/layouts/main-layout.ts
import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import tailwindStyles from "../../styles/main.css?inline";

// Adopt the global stylesheet for Tailwind utility classes.
const sheet = new CSSStyleSheet();
sheet.replaceSync(tailwindStyles);

@customElement("main-layout")
export class MainLayout extends LitElement {
  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot!.adoptedStyleSheets = [sheet];
  }

  render() {
    return html`
      <div class="min-h-screen bg-gray-50 text-gray-900">
        <header class="bg-white p-4 shadow-sm">
          <slot name="header">
            <h1 class="text-xl font-bold">Default Header</h1>
          </slot>
        </header>
        <main class="p-4">
          <slot></slot>
        </main>
      </div>
    `;
  }
}
