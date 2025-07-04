// File: ./components/pages/forgot-password-page.ts
import { render, html, type TemplateResult, nothing } from "lit-html";
import { pipe, Effect, Data, Ref, Queue, Fiber } from "effect";
import { trpc } from "../../lib/client/trpc";
import { clientLog } from "../../lib/client/logger.client";
import { runClientUnscoped } from "../../lib/client/runtime";
import { NotionButton } from "../ui/notion-button";
import { navigate } from "../../lib/client/router";

// --- Custom Error Types ---
class RequestResetError extends Data.TaggedError("RequestResetError")<{
  readonly cause: unknown;
}> {}

// --- Types ---
interface ViewResult {
  template: TemplateResult;
  cleanup?: () => void;
}
interface Model {
  email: string;
  status: "idle" | "loading" | "success" | "error";
  message: string | null;
}
type Action =
  | { type: "UPDATE_EMAIL"; payload: string }
  | { type: "REQUEST_START" }
  | { type: "REQUEST_COMPLETE" };

export const ForgotPasswordView = (): ViewResult => {
  const container = document.createElement("div");
  const componentProgram = Effect.gen(function* () {
    // --- State and Action Queue ---
    const model = yield* Ref.make<Model>({
      email: "",
      status: "idle",
      message: null,
    });
    const actionQueue = yield* Queue.unbounded<Action>();

    // --- Propose Action ---
    const propose = (action: Action) =>
      Effect.runFork(
        pipe(
          clientLog(
            "debug",
            `ForgotPasswordView: Proposing action ${action.type}`,
            undefined,
            "ForgotPassword:propose",
          ),
          Effect.andThen(() => Queue.offer(actionQueue, action)),
        ),
      );

    // --- Action Handler ---
    const handleAction = (action: Action): Effect.Effect<void> =>
      Effect.gen(function* () {
        const currentModel = yield* Ref.get(model);
        switch (action.type) {
          case "UPDATE_EMAIL":
            yield* Ref.update(
              model,
              (m): Model => ({
                ...m,
                email: action.payload,
                status: "idle",
                message: null,
              }),
            );
            break;

          case "REQUEST_START": {
            yield* Ref.update(
              model,
              (m): Model => ({ ...m, status: "loading", message: null }),
            );
            const requestEffect = pipe(
              Effect.tryPromise({
                try: () =>
                  trpc.auth.requestPasswordReset.mutate({
                    email: currentModel.email,
                  }),
                catch: (err) => new RequestResetError({ cause: err }),
              }),
              Effect.tap(() =>
                clientLog(
                  "info",
                  `Password reset requested for ${currentModel.email}.`,
                  undefined,
                  "ForgotPassword",
                ),
              ),
              Effect.catchAll((error) =>
                clientLog(
                  "error",
                  // --- FIX: Explicitly cast the unknown cause to a string ---
                  `Password reset request failed: ${String(error.cause)}`,
                  undefined,
                  "ForgotPassword",
                ),
              ),
              Effect.andThen(() => propose({ type: "REQUEST_COMPLETE" })),
            );
            yield* Effect.fork(requestEffect);
            break;
          }

          case "REQUEST_COMPLETE":
            yield* Ref.update(
              model,
              (m): Model => ({
                ...m,
                status: "success",
                message:
                  "If an account with that email exists, a password reset link has been sent.",
                email: "",
              }),
            );
            break;
        }
      });

    // --- Render ---
    const renderView = (currentModel: Model) => {
      const handleSubmit = (e: Event) => {
        e.preventDefault();
        if (currentModel.status === "loading") return;
        propose({ type: "REQUEST_START" });
      };
      const template = html`
        <div class="flex min-h-screen items-center justify-center bg-gray-100">
          <div class="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
            <h2 class="mb-6 text-center text-2xl font-bold">Forgot Password</h2>
            ${currentModel.status === "success"
              ? html`<div class="text-center text-green-600">
                    ${currentModel.message}
                  </div>
                  <div class="mt-4 text-center text-sm">
                    <a
                      href="/login"
                      @click=${(e: Event) => {
                        e.preventDefault();
                        runClientUnscoped(navigate("/login"));
                      }}
                      class="font-medium text-zinc-600 hover:text-zinc-500"
                      >Back to Login</a
                    >
                  </div>`
              : html` <p class="mb-4 text-center text-sm text-zinc-600">
                    Enter your email address and we will send you a link to
                    reset your password.
                  </p>
                  <form @submit=${handleSubmit}>
                    <div class="mb-4">
                      <label
                        for="email"
                        class="block text-sm font-medium text-gray-700"
                        >Email</label
                      >
                      <input
                        type="email"
                        id="email"
                        .value=${currentModel.email}
                        @input=${(e: Event) =>
                          propose({
                            type: "UPDATE_EMAIL",
                            payload: (e.target as HTMLInputElement).value,
                          })}
                        class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-zinc-500 sm:text-sm"
                        required
                      />
                    </div>
                    ${currentModel.status === "error"
                      ? html`<div class="mb-4 text-sm text-red-500">
                          ${currentModel.message}
                        </div>`
                      : nothing}
                    ${NotionButton({
                      children:
                        currentModel.status === "loading"
                          ? "Sending..."
                          : "Send Reset Link",
                      type: "submit",
                      loading: currentModel.status === "loading",
                    })}
                  </form>
                  <div class="mt-4 text-center text-sm">
                    <a
                      href="/login"
                      @click=${(e: Event) => {
                        e.preventDefault();
                        runClientUnscoped(navigate("/login"));
                      }}
                      class="font-medium text-zinc-600 hover:text-zinc-500"
                      >Back to Login</a
                    >
                  </div>`}
          </div>
        </div>
      `;
      render(template, container);
    };
    const renderEffect = Ref.get(model).pipe(
      Effect.tap(renderView),
      Effect.tap((m) =>
        clientLog(
          "debug",
          `Rendering ForgotPasswordView with state: ${JSON.stringify(m)}`,
          undefined,
          "ForgotPassword:render",
        ),
      ),
    );
    // --- Main Loop ---
    yield* renderEffect; // Initial render

    const mainLoop = Queue.take(actionQueue).pipe(
      Effect.flatMap(handleAction),
      Effect.andThen(renderEffect),
      Effect.catchAllDefect((defect) =>
        clientLog(
          "error",
          `[FATAL] Uncaught defect in ForgotPasswordView main loop: ${String(defect)}`,
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
          "ForgotPasswordView cleanup running, interrupting fiber.",
          undefined,
          "ForgotPassword:cleanup",
        ),
      );
      runClientUnscoped(Fiber.interrupt(fiber));
    },
  };
};
