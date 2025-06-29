// Create new file: components/pages/unauthorized-page.ts
import { html, type TemplateResult } from "lit-html";

interface ViewResult {
  template: TemplateResult;
  cleanup?: () => void;
}

export const UnauthorizedView = (): ViewResult => {
  return {
    template: html`
      <div class="py-16 text-center">
        <h1 class="text-4xl font-bold">403 - Not Authorized</h1>
        <p class="mt-4 text-lg text-zinc-600">
          You do not have permission to view this page.
        </p>
        <a href="/" class="mt-6 inline-block text-zinc-600 hover:text-zinc-900">
          ← Go back to Home
        </a>
      </div>
    `,
  };
};
