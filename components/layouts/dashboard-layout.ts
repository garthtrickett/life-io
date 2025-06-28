// File: ./components/layouts/dashboard-layout.ts
// NEW: A second, more complex layout demonstrating a responsive sidebar.
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import tailwindStyles from "../../styles/main.css?inline";

const sheet = new CSSStyleSheet();
sheet.replaceSync(tailwindStyles);

@customElement("dashboard-layout")
export class DashboardLayout extends LitElement {
  @state()
  private _isSidebarOpen = true;

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot!.adoptedStyleSheets = [sheet];
  }

  private _toggleSidebar() {
    this._isSidebarOpen = !this._isSidebarOpen;
  }

  render() {
    return html`
      <div class="relative min-h-screen md:flex">
        <aside
          class="bg-gray-800 text-gray-100 transition-all duration-300 ${this
            ._isSidebarOpen
            ? "w-64"
            : "w-16"}"
        >
          <div class="p-4 flex justify-between items-center">
            <span
              class="${this._isSidebarOpen
                ? "opacity-100"
                : "opacity-0"} transition-opacity"
              >Dashboard Menu</span
            >
            <button
              @click=${this._toggleSidebar}
              class="p-1 rounded-md hover:bg-gray-700"
            >
              <svg
                class="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 6h16M4 12h16m-7 6h7"
                ></path>
              </svg>
            </button>
          </div>
          <nav>
            <slot name="sidebar"> </slot>
          </nav>
        </aside>

        <div class="flex-1 p-10 text-2xl font-bold">
          <slot></slot>
        </div>
      </div>
    `;
  }
}
