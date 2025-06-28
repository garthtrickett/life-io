// File: ./components/life-io-app.ts
import "urlpattern-polyfill";
import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { Router } from "@lit-labs/router";
import "./home-page.ts";
import "./my-note-form.ts";

// --- FIX START ---
// 1. Import the shared Tailwind CSS styles as a string.
import tailwindStyles from "../styles/main.css?inline";

// 2. Create a single, reusable stylesheet for adoption.
const sheet = new CSSStyleSheet();
sheet.replaceSync(tailwindStyles);
// --- FIX END ---

@customElement("life-io-app")
export class LifeIoApp extends LitElement {
  // 3. The `createRenderRoot` method is removed to re-enable Shadow DOM.
  // This provides style encapsulation for the main app shell.

  // 4. Adopt the shared stylesheet to apply Tailwind classes inside the Shadow DOM.
  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot!.adoptedStyleSheets = [sheet];
  }

  private router = new Router(this, [
    { path: "/", render: () => html`<home-page></home-page>` },
    { path: "/create", render: () => html`<my-note-form></my-note-form>` },
  ]);

  render() {
    // 5. The `<body>` tag is removed from the component's template. The component
    // now renders a layout container, as it lives inside the document's body.
    return html`
           
      <div class="flex flex-col min-h-screen">
               
        <header class="bg-white border-b border-zinc-200">
                   
          <nav class="container mx-auto p-4 flex items-center justify-between">
                       
            <a href="/" class="text-xl font-bold text-zinc-900">Life IO</a>
                       
            <div>
                           
              <a href="/" class="px-3 py-2 text-zinc-600 hover:text-zinc-900"
                >Home</a
              >
                           
              <a
                href="/create"
                class="px-3 py-2 text-zinc-600 hover:text-zinc-900"
                >Create Note</a
              >
                         
            </div>
                     
          </nav>
                 
        </header>
               
        <main class="flex-grow container mx-auto p-4">
                    ${this.router.outlet()}        
        </main>
             
      </div>
         
    `;
  }
}
