// FILE: ./components/pages/reset-password-page.ts
import { render, html, type TemplateResult, nothing } from "lit-html";
import { pipe, Effect, Data, Ref, Queue, Fiber } from "effect";
import { trpc } from "../../lib/client/trpc";
import { navigate } from "../../lib/client/router";
import { NotionButton } from "../ui/notion-button";
import { runClientUnscoped } from "../../lib/client/runtime";
import { clientLog } from "../../lib/client/logger.client";
import type { LocationService } from "../../lib/client/LocationService";
import { tryTrpc } from "../../lib/client/trpc/tryTrpc";

// --- Custom Error Types ---
class InvalidTokenError extends Data.TaggedError("InvalidTokenError") {}
class PasswordResetError extends Data.TaggedError("PasswordResetError")<{
  readonly cause: unknown;
}> {}

// --- Types ---
interface ViewResult {
  template: TemplateResult;
  cleanup?: () => void;
}
interface Model {
  password: string;
  status: "idle" | "loading" | "success" | "error";
  message: string | null;
}
type Action =
  | { type: "UPDATE_PASSWORD"; payload: string }
  | { type: "RESET_START" }
  | { type: "RESET_SUCCESS" }
  | { type: "RESET_ERROR"; payload: InvalidTokenError | PasswordResetError };

export const ResetPasswordView = (token: string): ViewResult => {
  const container = document.createElement("div");
  const componentProgram = Effect.gen(function* () {
    const model = yield* Ref.make<Model>({
      password: "",
      status: "idle",
      message: null,
    });
    const actionQueue = yield* Queue.unbounded<Action>();

    const propose = (action: Action) =>
      Effect.runFork(
        pipe(
          clientLog(
            "debug",
            `ResetPasswordView: Proposing action ${action.type}`,
          ),
          Effect.andThen(Queue.offer(actionQueue, action)),
        ),
      );

    const handleAction = (
      action: Action,
    ): Effect.Effect<void, never, LocationService> =>
      Effect.gen(function* () {
        const currentModel = yield* Ref.get(model);
        switch (action.type) {
          case "UPDATE_PASSWORD":
            yield* Ref.update(
              model,
              (m): Model => ({
                ...m,
                password: action.payload,
                status: "idle",
                message: null,
              }),
            );
            break;
          case "RESET_START": {
            yield* Ref.update(
              model,
              (m): Model => ({ ...m, status: "loading", message: null }),
            );

            // --- REFACTORED with tryTrpc helper ---
            const resetEffect = pipe(
              tryTrpc(
                () =>
                  trpc.auth.resetPassword.mutate({
                    token,
                    password: currentModel.password,
                  }),
                {
                  BAD_REQUEST: () => new InvalidTokenError(),
                },
              ),
              Effect.catchTag("UnknownTrpcError", (e) =>
                Effect.fail(new PasswordResetError({ cause: e.cause })),
              ),
              Effect.match({
                onSuccess: () => propose({ type: "RESET_SUCCESS" }),
                onFailure: (error) =>
                  propose({ type: "RESET_ERROR", payload: error }),
              }),
            );
            // --- END OF REFACTOR ---

            yield* Effect.fork(resetEffect);
            break;
          }
          case "RESET_SUCCESS": {
            yield* Ref.update(
              model,
              (m): Model => ({
                ...m,
                status: "success",
                message:
                  "Password has been reset successfully. You can now log in.",
              }),
            );
            // Navigate after a delay
            yield* Effect.sleep("3 seconds").pipe(
              Effect.andThen(navigate("/login")),
              Effect.fork,
            );
            break;
          }
          case "RESET_ERROR": {
            let errorMessage = "An unknown error occurred.";
            if (action.payload._tag === "InvalidTokenError") {
              errorMessage =
                "This password reset link is invalid or has expired.";
            }
            yield* Ref.update(
              model,
              (m): Model => ({ ...m, status: "error", message: errorMessage }),
            );
            break;
          }
        }
      });

    const renderView = (currentModel: Model) => {
      const handleSubmit = (e: Event) => {
        e.preventDefault();
        if (currentModel.status === "loading") return;
        propose({ type: "RESET_START" });
      };
      const template = html`
        <div class="flex min-h-screen items-center justify-center bg-gray-100">
          <div class="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
            <h2 class="mb-6 text-center text-2xl font-bold">Reset Password</h2>
            ${currentModel.status === "success"
              ? html` <div class="text-center text-green-600">
                    ${currentModel.message}
                  </div>
                  <p class="mt-2 text-center text-sm">
                    Redirecting to login...
                  </p>`
              : html` <form @submit=${handleSubmit}>
                  <div class="mb-6">
                    <label
                      for="password"
                      class="block text-sm font-medium text-gray-700"
                      >New Password (min. 8 characters)</label
                    >
                    <input
                      type="password"
                      id="password"
                      .value=${currentModel.password}
                      @input=${(e: Event) =>
                        propose({
                          type: "UPDATE_PASSWORD",
                          payload: (e.target as HTMLInputElement).value,
                        })}
                      class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-zinc-500 sm:text-sm"
                      required
                    />
                  </div>
                  ${currentModel.message
                    ? html`<div class="mb-4 text-sm text-red-500">
                        ${currentModel.message}
                      </div>`
                    : nothing}
                  ${NotionButton({
                    children:
                      currentModel.status === "loading"
                        ? "Resetting..."
                        : "Reset Password",
                    type: "submit",
                    loading: currentModel.status === "loading",
                  })}
                </form>`}
          </div>
        </div>
      `;
      render(template, container);
    };

    const renderEffect = Ref.get(model).pipe(Effect.tap(renderView));

    // Initial render
    yield* renderEffect;
    // Main loop
    yield* Queue.take(actionQueue).pipe(
      Effect.flatMap(handleAction),
      Effect.andThen(renderEffect),
      Effect.forever,
    );
  });

  const fiber = runClientUnscoped(componentProgram);
  return {
    template: html`${container}`,
    cleanup: () => {
      runClientUnscoped(Fiber.interrupt(fiber));
    },
  };
};
