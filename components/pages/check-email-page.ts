// File: ./components/pages/check-email-page.ts
import { html } from "lit-html";
import { navigate } from "../../lib/client/router";
import type { ViewResult } from "../../lib/client/router";
import { runClientUnscoped } from "../../lib/client/runtime";

/**
 * A simple, static view to inform the user to check their email for a
 * verification link after signing up.
 */
export const CheckEmailView = (): ViewResult => {
  return {
    template: html`
      <div class="flex min-h-screen items-center justify-center bg-gray-100">
        <div
          class="w-full max-w-md rounded-lg bg-white p-8 text-center shadow-md"
        >
          <h2 class="text-2xl font-bold">Check Your Email</h2>
          <p class="mt-4 text-zinc-600">
            We've sent a verification link to your email address. Please click
            the link in the email to complete your registration before logging
            in.
          </p>
          <div class="mt-6">
            <a
              href="/login"
              @click=${(e: Event) => {
                e.preventDefault();
                runClientUnscoped(navigate("/login"));
              }}
              class="font-medium text-zinc-600 hover:text-zinc-500"
            >
              Back to Login
            </a>
          </div>
        </div>
      </div>
    `,
  };
};
