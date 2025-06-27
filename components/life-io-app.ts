// File: ./components/life-io-app.ts

import "urlpattern-polyfill";
import { LitElement, html, css } from "lit";
import { customElement } from "lit/decorators.js";
import { Router } from "@lit-labs/router";
import "./home-page.ts";
import "./my-note-form.ts";

@customElement("life-io-app")
export class LifeIoApp extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 100vh;
      font-family: system-ui, sans-serif;
      background-color: #f4f4f5;
      color: #18181b;
    }
    nav {
      padding: 1rem;
      background-color: #ffffff;
      border-bottom: 1px solid #e4e4e7;
    }
    nav a {
      margin: 0 0.5rem;
      color: #3f3f46;
      text-decoration: none;
      font-weight: 500;
    }
    nav a:hover {
      text-decoration: underline;
    }
    .logo {
      font-size: 1.25rem;
      font-weight: bold;
      color: #18181b;
    }
    main {
      flex-grow: 1;
    }
  `;

  private router = new Router(this, [
    { path: "/", render: () => html`<home-page></home-page>` },
    { path: "/create", render: () => html`<my-note-form></my-note-form>` },
  ]);

  render() {
    return html`
      <header>
        <nav>
          <a href="/" class="logo">Life IO</a>
          <a href="/">Home</a>
          <a href="/create">Create Note</a>
        </nav>
      </header>

      <main>${this.router.outlet()}</main>
    `;
  }
}
