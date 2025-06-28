import { LitElement, html, css } from "lit";
// --- FIX START ---
// The @property decorator is now correctly imported alongside the others.
import { customElement, property, state } from "lit/decorators.js";
// --- FIX END ---

import tailwindStyles from "../styles/main.css?inline";

const sheet = new CSSStyleSheet();
sheet.replaceSync(tailwindStyles);

// --- SAM (State-Action-Model) Pattern with Effects ---

interface Model {
  loading: boolean;
}

type Action = { type: "CLICK" } | { type: "SET_LOADING"; payload: boolean };

const update = (model: Model, action: Action): Model => {
  switch (action.type) {
    case "CLICK":
      return { ...model, loading: true };
    case "SET_LOADING":
      return { ...model, loading: action.payload };
    default:
      return model;
  }
};

// --- Web Component Implementation ---

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

  @state()
  private _model: Model = {
    loading: false,
  };

  @property({ type: Boolean, reflect: true })
  set loading(isLoading: boolean) {
    this.propose({ type: "SET_LOADING", payload: isLoading });
  }

  get loading(): boolean {
    return this._model.loading;
  }

  private propose(action: Action) {
    this._model = update(this._model, action);
    this.react(action);
  }

  private react(action: Action) {
    if (action.type === "CLICK") {
      this.dispatchEvent(
        new CustomEvent("notion-button-click", {
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  private handleClick() {
    if (this._model.loading) return;
    this.propose({ type: "CLICK" });
  }

  render() {
    const { loading } = this._model;

    return html`
      <button
        @click=${this.handleClick}
        ?disabled=${loading}
        aria-busy=${loading}
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
        ${loading
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
