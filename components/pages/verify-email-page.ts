// FILE: ./components/pages/verify-email-page.ts
import { render, html, type TemplateResult } from "lit-html";
import { pipe, Effect, Data, Ref, Queue, Fiber } from "effect";
import { trpc } from "../../lib/client/trpc";
import { runClientUnscoped } from "../../lib/client/runtime";
import { proposeAuthAction } from "../../lib/client/stores/authStore";
import { navigate } from "../../lib/client/router";
import type { User } from "../../types/generated/public/User";
import { clientLog } from "../../lib/client/logger.client";
import { tryTrpc } from "../../lib/client/trpc/tryTrpc";

// --- Custom Error Types ---
class InvalidTokenError extends Data.TaggedError("InvalidTokenError") {}
class UnknownVerificationError extends Data.TaggedError(
  "UnknownVerificationError",
)<{
  readonly cause: unknown;
}> {}

// --- Types ---
interface ViewResult {
  template: TemplateResult;
  cleanup?: () => void;
}
interface Model {
  status: "verifying" | "success" | "error";
  message: string | null;
}
interface VerifySuccessPayload {
  user: User;
  sessionId: string;
}
type Action =
  | { type: "VERIFY_START" }
  | { type: "VERIFY_SUCCESS"; payload: VerifySuccessPayload }
  | {
      type: "VERIFY_ERROR";
      payload: InvalidTokenError | UnknownVerificationError;
    };

export const VerifyEmailView = (token: string): ViewResult => {
  const container = document.createElement("div");
  const componentProgram = Effect.gen(function* () {
    // --- State and Action Queue ---
    const model = yield* Ref.make<Model>({
      status: "verifying",
      message: "Verifying your email...",
    });
    const actionQueue = yield* Queue.unbounded<Action>();

    // --- Propose Action ---
    const propose = (action: Action) =>
      Effect.runFork(
        pipe(
          clientLog(
            "debug",
            `VerifyEmailView: Proposing action ${action.type}`,
            undefined,
            "VerifyEmailView:propose",
          ),
          Effect.andThen(Queue.offer(actionQueue, action)),
        ),
      );

    // --- Action Handler ---
    const handleAction = (action: Action): Effect.Effect<void> =>
      Effect.gen(function* () {
        switch (action.type) {
          case "VERIFY_START": {
            yield* Ref.update(
              model,
              (m): Model => ({
                ...m,
                status: "verifying",
                message: "Verifying your email...",
              }),
            );

            // --- REFACTORED with tryTrpc helper ---
            const verifyEffect = pipe(
              tryTrpc(() => trpc.auth.verifyEmail.mutate({ token }), {
                BAD_REQUEST: () => new InvalidTokenError(),
              }),
              Effect.catchTag("UnknownTrpcError", (e) =>
                Effect.fail(new UnknownVerificationError({ cause: e.cause })),
              ),
              Effect.match({
                onSuccess: (result) => {
                  propose({
                    type: "VERIFY_SUCCESS",
                    payload: result as VerifySuccessPayload,
                  });
                },
                onFailure: (error) => {
                  propose({ type: "VERIFY_ERROR", payload: error });
                },
              }),
            );
            // --- END OF REFACTOR ---

            yield* Effect.fork(verifyEffect);
            break;
          }
          case "VERIFY_SUCCESS": {
            yield* Ref.update(
              model,
              (m): Model => ({
                ...m,
                status: "success",
                message: "Email verified successfully! Redirecting you...",
              }),
            );
            const { user, sessionId } = action.payload;
            const expires = new Date();
            expires.setDate(expires.getDate() + 30);
            document.cookie = `session_id=${sessionId}; path=/; expires=${expires.toUTCString()}; SameSite=Lax`;
            proposeAuthAction({ type: "SET_AUTHENTICATED", payload: user });
            runClientUnscoped(
              clientLog(
                "info",
                "Email verified and user logged in. Navigating to home.",
              ),
            );
            navigate("/");
            break;
          }
          case "VERIFY_ERROR": {
            let errorMessage = "An unknown error occurred during verification.";
            if (action.payload._tag === "InvalidTokenError") {
              errorMessage =
                "This verification link is invalid or has expired.";
            }
            yield* Ref.update(
              model,
              (m): Model => ({ ...m, status: "error", message: errorMessage }),
            );
            break;
          }
        }
      });

    // --- Render ---
    const renderView = (currentModel: Model) => {
      const renderContent = () => {
        switch (currentModel.status) {
          case "verifying":
            return html`<div
                class="h-12 w-12 animate-spin rounded-full border-4 border-zinc-300 border-t-zinc-600"
              ></div>
              <p class="mt-4 text-zinc-600">
                ${currentModel.message || "Verifying..."}
              </p>`;
          case "success":
            return html`<h2 class="text-2xl font-bold text-green-600">
                Success!
              </h2>
              <p class="mt-4 text-zinc-600">${currentModel.message}</p>`;
          case "error":
            return html`<h2 class="text-2xl font-bold text-red-600">Error</h2>
              <p class="mt-4 text-zinc-600">${currentModel.message}</p>
              <div class="mt-6">
                <a
                  href="/login"
                  class="font-medium text-zinc-600 hover:text-zinc-500"
                  >Back to Login</a
                >
              </div>`;
        }
      };
      const template = html`
        <div class="flex min-h-screen items-center justify-center bg-gray-100">
          <div
            class="flex w-full max-w-md flex-col items-center rounded-lg bg-white p-8 text-center shadow-md"
          >
            ${renderContent()}
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
          `Rendering VerifyEmailView with state: ${JSON.stringify(m)}`,
          undefined,
          "VerifyEmailView:render",
        ),
      ),
    );

    // --- Main Loop ---
    propose({ type: "VERIFY_START" }); // Initial action

    const mainLoop = Queue.take(actionQueue).pipe(
      Effect.flatMap(handleAction),
      Effect.andThen(renderEffect),
      Effect.catchAllDefect((defect) =>
        clientLog(
          "error",
          `[FATAL] Uncaught defect in VerifyEmailView main loop: ${String(
            defect,
          )}`,
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
          "VerifyEmailView cleanup running, interrupting fiber.",
          undefined,
          "VerifyEmailView:cleanup",
        ),
      );
      runClientUnscoped(Fiber.interrupt(fiber));
    },
  };
};
