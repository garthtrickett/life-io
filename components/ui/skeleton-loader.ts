// File: ./components/ui/skeleton-loader.ts
// NEW: Implements the requested skeleton/shimmer loader component.
import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import tailwindStyles from "../../styles/main.css?inline";

const sheet = new CSSStyleSheet();
sheet.replaceSync(tailwindStyles);

@customElement("skeleton-loader")
export class SkeletonLoader extends LitElement {
  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot!.adoptedStyleSheets = [sheet];
  }

  render() {
    // The component itself is a simple div with Tailwind's animation classes.
    // It can be sized using standard Tailwind classes (e.g., h-4, w-full) where used.
    return html`
      <div class="animate-pulse rounded-md bg-gray-300">&nbsp;</div>
    `;
  }
}
