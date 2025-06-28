/* components/notion-button-a11y.ts */
import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

// Import your global Tailwind styles. Vite will process this into a CSS string.
import tailwindStyles from "../styles/main.css?inline";

// --- The Fix: Create a reusable stylesheet ---
// 1. Create a CSSStyleSheet object from the imported string.
//    This is parsed by the browser ONCE, making it very performant.
const sheet = new CSSStyleSheet();
sheet.replaceSync(tailwindStyles);
// ------------------------------------------

@customElement("notion-button")
export class NotionButton extends LitElement {
  // Use a standard `styles` property for any styles UNIQUE to this component.
  static styles = [
    css`
      :host {
        display: inline-block;
      }
    `,
  ];

  // The createRenderRoot() method is removed to enable the Shadow DOM.

  @property({ type: Boolean, reflect: true })
  loading = false;

  @property({ attribute: false })
  action?: () => Promise<unknown>;

  connectedCallback() {
    super.connectedCallback();
    // 2. In the connectedCallback, adopt the shared stylesheet.
    //    This applies the full suite of Tailwind classes to this component's Shadow DOM.
    this.shadowRoot!.adoptedStyleSheets = [sheet];
  }

  private handleClick() {
    if (this.loading) return;
    this.dispatchEvent(
      new CustomEvent("notion-button-click", { bubbles: true, composed: true }),
    );
  }

  updated() {
    this.setAttribute("aria-busy", String(this.loading));
  }

  render() {
    // The render function remains the same. The `class="..."` attributes
    // will now be correctly applied from the adopted stylesheet.
    return html`
      <button
        @click=${this.handleClick}
        ?disabled=${this.loading}
        class="
          inline-flex items-center justify-center gap-2
          px-4 py-2
          bg-zinc-800 text-white font-semibold text-sm
          border border-transparent rounded-md
          transition-colors duration-150
          hover:bg-zinc-700
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2
          disabled:bg-zinc-600 disabled:pointer-events-none
        "
      >
        ${this.loading
          ? html`
              <span
                class="w-4 h-4 border-2 border-zinc-600 border-t-white rounded-full animate-spin"
                aria-hidden="true"
              ></span>
            `
          : ""}
        <slot></slot>
      </button>
    `;
  }
}
