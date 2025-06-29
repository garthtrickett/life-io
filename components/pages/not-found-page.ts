import { html, type TemplateResult } from "lit-html";

interface ViewResult {
  template: TemplateResult;
  cleanup?: () => void;
}

export const NotFoundView = (): ViewResult => {
  return {
    template: html`
      <div class="py-16 text-center">
        <h1 class="text-4xl font-bold">404 - Page Not Found</h1>
        <p class="mt-4 text-lg text-zinc-600">
          The page you are looking for does not exist.
        </p>
        <a href="/" class="mt-6 inline-block text-zinc-600 hover:text-zinc-900">
          ← Go back to Home
        </a>
      </div>
    `,
  };
};
