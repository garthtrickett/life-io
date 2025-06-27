/* notion-button-a11y.ts */
import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("notion-button")
export class NotionButton extends LitElement {
  static styles = css`
    /* The spinner animation is the primary style needed here,
      as Tailwind will handle the rest via the linked stylesheet. */
    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid rgba(55, 53, 47, 0.25);
      border-top-color: #20201c;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    /* Keep the accessible visually hidden utility */
    .sr-only {
      position: absolute !important;
      width: 1px;
      height: 1px;
      margin: -1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      border: 0;
    }
  `;

  // Shadow DOM is enabled so that <slot> works correctly.

  @property({ type: Boolean, reflect: true }) loading = false;

  @property({ attribute: false }) action?: () => Promise<unknown>;

  private async handleClick() {
    if (this.loading) return;
    this.dispatchEvent(
      new CustomEvent("notion-button-click", { bubbles: true, composed: true }),
    );
    if (this.action) {
      try {
        this.loading = true;
        await this.action();
      } finally {
        this.loading = false;
      }
    }
  }

  updated() {
    this.setAttribute("aria-busy", String(this.loading));
  }

  render() {
    return html`
      <link rel="stylesheet" href="/tailwind.css" />
      <button
        @click=${this.handleClick}
        ?disabled=${this.loading}
        class="
          inline-flex items-center justify-center gap-2
          px-3 py-1.5
          bg-white text-zinc-800 font-medium text-sm
          border border-zinc-300 rounded-sm
          transition-colors duration-150
          hover:bg-zinc-100
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2
          disabled:opacity-60 disabled:pointer-events-none
        "
      >
        ${this.loading
          ? html` <span class="spinner" aria-hidden="true"></span> `
          : ""}
        <slot></slot>
      </button>
    `;
  }
}
