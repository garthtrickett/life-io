// File: ./components/notion-button-a11y.ts
import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import tailwindStyles from "../styles/main.css?inline";

const sheet = new CSSStyleSheet();
sheet.replaceSync(tailwindStyles);

/**
 * A unified button component that can render as a <button> or an <a> tag
 * for consistent styling across the application.
 */
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

  /**
   * When true, displays a loading spinner and disables the button.
   */
  @property({ type: Boolean, reflect: true })
  loading = false;

  /**
   * If provided, the component will render as an anchor (<a>) tag.
   * If omitted, it will render as a <button>.
   */
  @property({ type: String })
  href?: string;

  private handleClick(e: MouseEvent) {
    if (this.loading) {
      e.preventDefault(); // Prevent navigation or form submission
      return;
    }
    // Only dispatch the custom click event for <button> behavior
    if (!this.href) {
      this.dispatchEvent(
        new CustomEvent("notion-button-click", {
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  render() {
    // A single source of truth for styling both the button and the link
    const baseClasses =
      "inline-flex items-center justify-center gap-2 px-4 py-2 bg-zinc-800 text-white rounded-md hover:bg-zinc-700 font-semibold text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2";

    const disabledClasses = "disabled:bg-zinc-600 disabled:pointer-events-none";

    const spinner = html`
      <span
        class="w-4 h-4 border-2 border-zinc-500 border-t-white rounded-full animate-spin"
        aria-hidden="true"
      ></span>
    `;

    // Render as a link if 'href' is provided
    if (this.href) {
      return html`
        <a href=${this.href} class=${baseClasses} @click=${this.handleClick}>
          <slot></slot>
        </a>
      `;
    }

    // Render as a button by default
    return html`
      <button
        @click=${this.handleClick}
        ?disabled=${this.loading}
        aria-busy=${this.loading}
        class="${baseClasses} ${disabledClasses}"
      >
        ${this.loading ? spinner : ""}
        <slot></slot>
      </button>
    `;
  }
}
