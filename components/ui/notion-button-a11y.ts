// File: ./components/ui/notion-button-a11y.ts
import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import tailwindStyles from "../../styles/main.css?inline";

const sheet = new CSSStyleSheet();
sheet.replaceSync(tailwindStyles);

@customElement("notion-button")
export class NotionButton extends LitElement {
  static styles = [
    css`
      :host {
        display: inline-block;
      }
    `,
  ];

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot!.adoptedStyleSheets = [sheet];
  }

  @property({ type: Boolean, reflect: true })
  loading = false;

  @property({ type: String })
  href?: string;

  @property({ type: String })
  type: "button" | "submit" | "reset" = "submit";

  /**
   * Dispatches a custom 'notion-button-click' event.
   * This allows parent components to react to clicks without relying on
   * native form submission behavior, which is broken by the Shadow DOM.
   */
  // --- FIX: Convert to an arrow function to preserve `this` context ---
  private _handleClick = () => {
    this.dispatchEvent(
      new CustomEvent("notion-button-click", {
        bubbles: true, // Allows the event to bubble up through the DOM
        composed: true, // Allows the event to cross the Shadow DOM boundary
      }),
    );
  };

  render() {
    const baseClasses =
      "inline-flex items-center justify-center gap-2 px-4 py-2 bg-zinc-800 text-white rounded-md hover:bg-zinc-700 font-semibold text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2";

    const disabledClasses = "disabled:bg-zinc-600 disabled:pointer-events-none";

    const spinner = html`
      <span
        class="h-4 w-4 animate-spin rounded-full border-2 border-zinc-500 border-t-white"
        aria-hidden="true"
      ></span>
    `;

    if (this.href) {
      return html`
        <a href=${this.href} class=${baseClasses}>
          <slot></slot>
        </a>
      `;
    }

    return html`
      <button
        .type=${this.type}
        ?disabled=${this.loading}
        aria-busy=${this.loading}
        @click=${this._handleClick}
        class="${baseClasses} ${disabledClasses}"
      >
        ${this.loading ? spinner : ""}
        <slot></slot>
      </button>
    `;
  }
}
