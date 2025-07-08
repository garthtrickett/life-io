// File: ./components/pages/signup-page.ts
import { render, html, type TemplateResult, nothing } from "lit-html";
import { pipe, Effect, Data, Ref, Queue, Fiber } from "effect";
import { trpc } from "../../lib/client/trpc";
import { clientLog } from "../../lib/client/logger.client";
import { NotionButton } from "../ui/notion-button";
import { runClientUnscoped } from "../../lib/client/runtime";
import { navigate } from "../../lib/client/router";
import type { LocationService } from "../../lib/client/LocationService";

// --- Custom Error Types ---
class EmailInUseError extends Data.TaggedError("EmailInUseError") {}
class UnknownSignupError extends Data.TaggedError("UnknownSignupError")<{
  readonly cause: unknown;
}> {}

// --- Types ---
interface ViewResult {
  template: TemplateResult;
  cleanup?: () => void;
}

interface Model {
  email: string;
  password: string;
  error: string | null;
  isLoading: boolean;
}

type Action =
  | { type: "UPDATE_EMAIL"; payload: string }
  | { type: "UPDATE_PASSWORD"; payload: string }
  | { type: "SIGNUP_START" }
  | { type: "SIGNUP_SUCCESS"; payload: { success: boolean; email: string } }
  | { type: "SIGNUP_ERROR"; payload: EmailInUseError | UnknownSignupError };

// --- View ---
export const SignupView = (): ViewResult => {
  const container = document.createElement("div");
  const componentProgram = Effect.gen(function* () {
    // --- State and Action Queue ---
    const model = yield* Ref.make<Model>({
      email: "",
      password: "",
      error: null,
      isLoading: false,
    });
    const actionQueue = yield* Queue.unbounded<Action>();

    // --- Propose Action ---
    const propose = (action: Action) =>
      pipe(
        clientLog(
          "debug",
          `SignupView: Proposing action ${action.type}`,
          undefined,
          "SignupView:propose",
        ),
        Effect.andThen(() => Queue.offer(actionQueue, action)),
      );

    // --- Pure Render Function ---
    const renderView = (currentModel: Model) => {
      const handleSignupSubmit = (e: Event) => {
        e.preventDefault();
        if (currentModel.isLoading) return;
        runClientUnscoped(propose({ type: "SIGNUP_START" }));
      };

      const template = html`
        <div class="flex min-h-screen items-center justify-center bg-gray-100">
          <div class="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
            <h2 class="mb-6 text-center text-2xl font-bold">Create Account</h2>
            <form @submit=${handleSignupSubmit}>
              <div class="mb-4">
                <label
                  for="email"
                  class="block text-sm font-medium text-gray-700"
                  >Email</label
                >
                <input
                  type="email"
                  id="email"
                  class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-zinc-500 sm:text-sm"
                  .value=${currentModel.email}
                  @input=${(e: Event) =>
                    runClientUnscoped(
                      propose({
                        type: "UPDATE_EMAIL",
                        payload: (e.target as HTMLInputElement).value,
                      }),
                    )}
                  required
                />
              </div>
              <div class="mb-6">
                <label
                  for="password"
                  class="block text-sm font-medium text-gray-700"
                  >Password (min. 8 characters)</label
                >
                <input
                  type="password"
                  id="password"
                  class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-zinc-500 sm:text-sm"
                  .value=${currentModel.password}
                  @input=${(e: Event) =>
                    runClientUnscoped(
                      propose({
                        type: "UPDATE_PASSWORD",
                        payload: (e.target as HTMLInputElement).value,
                      }),
                    )}
                  required
                />
              </div>
              ${currentModel.error
                ? html`<div class="mb-4 text-sm text-red-500">
                    ${currentModel.error}
                  </div>`
                : nothing}
              ${NotionButton({
                children: currentModel.isLoading ? "Signing up..." : "Sign Up",
                type: "submit",
                loading: currentModel.isLoading,
              })}
            </form>
            <div class="mt-4 text-center text-sm">
              <a
                href="/login"
                class="font-medium text-zinc-600 hover:text-zinc-500"
                @click=${(e: Event) => {
                  e.preventDefault();
                  runClientUnscoped(navigate("/login"));
                }}
                >Already have an account? Log in.</a
              >
            </div>
          </div>
        </div>
      `;
      render(template, container);
    };

    // --- Action Handler ---
    // --- START OF FIX: Declare the LocationService requirement in the function's return type ---
    const handleAction = (
      action: Action,
    ): Effect.Effect<void, never, LocationService> =>
      // --- END OF FIX ---
      Effect.gen(function* () {
        const currentModel = yield* Ref.get(model);

        switch (action.type) {
          case "UPDATE_EMAIL":
            yield* Ref.update(model, (m) => ({
              ...m,
              email: action.payload,
              error: null,
            }));
            break;
          case "UPDATE_PASSWORD":
            yield* Ref.update(model, (m) => ({
              ...m,
              password: action.payload,
              error: null,
            }));
            break;
          case "SIGNUP_START": {
            yield* Ref.update(model, (m) => ({
              ...m,
              isLoading: true,
              error: null,
            }));
            const signupEffect = pipe(
              Effect.tryPromise({
                try: () =>
                  trpc.auth.signup.mutate({
                    email: currentModel.email,
                    password: currentModel.password,
                  }),
                catch: (err) => {
                  if (
                    typeof err === "object" &&
                    err !== null &&
                    "data" in err &&
                    (err.data as { code?: string }).code === "CONFLICT"
                  ) {
                    return new EmailInUseError();
                  }
                  return new UnknownSignupError({ cause: err });
                },
              }),
              Effect.matchEffect({
                onSuccess: (value) =>
                  propose({ type: "SIGNUP_SUCCESS", payload: value }),
                onFailure: (error) =>
                  propose({ type: "SIGNUP_ERROR", payload: error }),
              }),
            );
            yield* Effect.fork(signupEffect);
            break;
          }
          case "SIGNUP_SUCCESS":
            yield* Ref.update(model, (m) => ({ ...m, isLoading: false }));
            yield* clientLog(
              "info",
              `Signup success for ${action.payload.email}. Navigating to /check-email.`,
              undefined,
              "SignupView:handleAction",
            );
            yield* navigate("/check-email");
            break;
          case "SIGNUP_ERROR": {
            let errorMessage = "An unknown error occurred. Please try again.";
            if (action.payload._tag === "EmailInUseError") {
              errorMessage = "An account with this email already exists.";
            }
            yield* Ref.update(model, (m) => ({
              ...m,
              isLoading: false,
              error: errorMessage,
            }));
            break;
          }
        }
      });
    // --- Render Effect ---
    const renderEffect = Ref.get(model).pipe(
      Effect.tap(renderView),
      Effect.tap((m) =>
        clientLog(
          "debug",
          `Rendering SignupView with state: ${JSON.stringify(m)}`,
          undefined,
          "SignupView:render",
        ),
      ),
    );
    // --- Main Loop ---
    yield* renderEffect;
    // Initial render

    const mainLoop = Queue.take(actionQueue).pipe(
      Effect.flatMap(handleAction),
      Effect.andThen(renderEffect),
      Effect.catchAllDefect((defect) =>
        clientLog(
          "error",
          `[FATAL] Uncaught defect in SignupView main loop: ${String(defect)}`,
        ),
      ),
      Effect.forever,
    );
    yield* mainLoop;
  });

  // --- Fork Lifecycle ---
  const fiber = runClientUnscoped(componentProgram);
  return {
    template: html`${container}`,
    cleanup: () => {
      runClientUnscoped(
        clientLog(
          "debug",
          "SignupView cleanup running, interrupting fiber.",
          undefined,
          "SignupView:cleanup",
        ),
      );
      runClientUnscoped(Fiber.interrupt(fiber));
    },
  };
};
