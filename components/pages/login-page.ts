// FILE: ./components/pages/login-page.ts
import { render, html, type TemplateResult, nothing } from "lit-html";
import { pipe, Effect, Queue, Ref, Fiber, Data } from "effect";
import { trpc } from "../../lib/client/trpc";
import { proposeAuthAction } from "../../lib/client/stores/authStore";
import { NotionButton } from "../ui/notion-button";
import { runClientUnscoped } from "../../lib/client/runtime";
import { navigate } from "../../lib/client/router";
import type { User } from "../../types/generated/public/User";
import { clientLog } from "../../lib/client/logger.client";
import { tryTrpc } from "../../lib/client/trpc/tryTrpc";

// --- Custom Error Types ---
class LoginInvalidCredentialsError extends Data.TaggedError(
  "LoginInvalidCredentialsError",
) {}
class LoginEmailNotVerifiedError extends Data.TaggedError(
  "LoginEmailNotVerifiedError",
) {}
class UnknownLoginError extends Data.TaggedError("UnknownLoginError")<{
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

interface LoginSuccessPayload {
  sessionId: string;
  user: User;
}

type Action =
  | { type: "UPDATE_EMAIL"; payload: string }
  | { type: "UPDATE_PASSWORD"; payload: string }
  | { type: "LOGIN_START" }
  | { type: "LOGIN_SUCCESS"; payload: LoginSuccessPayload }
  | {
      type: "LOGIN_ERROR";
      payload:
        | LoginInvalidCredentialsError
        | LoginEmailNotVerifiedError
        | UnknownLoginError;
    };
// --- View ---
export const LoginView = (): ViewResult => {
  const container = document.createElement("div");
  runClientUnscoped(
    clientLog(
      "info",
      "LoginView created and componentProgram starting.",
      undefined,
      "LoginView",
    ),
  );
  const componentProgram = Effect.gen(function* () {
    yield* clientLog(
      "debug",
      "Login componentProgram started.",
      undefined,
      "LoginView:program",
    );

    const model = yield* Ref.make<Model>({
      email: "",
      password: "",
      error: null,
      isLoading: false,
    });
    const actionQueue = yield* Queue.unbounded<Action>();

    const propose = (action: Action) => {
      runClientUnscoped(
        clientLog(
          "debug",
          `Proposing action: ${action.type}`,
          undefined,
          "LoginView:propose",
        ),
      );
      return Effect.runFork(Queue.offer(actionQueue, action));
    };

    const renderView = (currentModel: Model) => {
      const handleLoginSubmit = (e: Event) => {
        e.preventDefault();
        propose({ type: "LOGIN_START" });
      };

      const template = html`
        <div class="flex min-h-screen items-center justify-center bg-gray-100">
          <div class="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
            <h2 class="mb-6 text-center text-2xl font-bold">Login</h2>
            <form @submit=${handleLoginSubmit}>
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
              <div class="mb-6">
                <label
                  for="password"
                  class="block text-sm font-medium text-gray-700"
                  >Password</label
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
              ${currentModel.error
                ? html`<div class="mb-4 text-sm text-red-500">
                    ${currentModel.error}
                  </div>`
                : nothing}
              ${NotionButton({
                children: currentModel.isLoading ? "Logging in..." : "Login",
                type: "submit",
                loading: currentModel.isLoading,
              })}
            </form>
            <div class="mt-4 text-center text-sm">
              <a
                href="/forgot-password"
                @click=${(e: Event) => {
                  e.preventDefault();
                  runClientUnscoped(navigate("/forgot-password"));
                }}
                class="font-medium text-zinc-500 hover:text-zinc-700"
              >
                Forgot your password?
              </a>
            </div>
            <div class="mt-2 text-center text-sm">
              <a
                href="/signup"
                class="font-medium text-zinc-600 hover:text-zinc-500"
                @click=${(e: Event) => {
                  e.preventDefault();
                  runClientUnscoped(navigate("/signup"));
                }}
              >
                Don't have an account? Sign up.
              </a>
            </div>
          </div>
        </div>
      `;
      render(template, container);
    };

    const handleAction = (action: Action): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* clientLog(
          "debug",
          `Handling action: ${action.type}`,
          undefined,
          "LoginView:handleAction",
        );
        const currentModel = yield* Ref.get(model);

        switch (action.type) {
          case "UPDATE_EMAIL":
            yield* Ref.set(model, {
              ...currentModel,
              email: action.payload,
              error: null,
            });
            break;
          case "UPDATE_PASSWORD":
            yield* Ref.set(model, {
              ...currentModel,
              password: action.payload,
              error: null,
            });
            break;
          case "LOGIN_START": {
            yield* clientLog(
              "info",
              `Login attempt for ${currentModel.email}`,
              undefined,
              "LoginView:handleAction",
            );
            yield* Ref.set(model, {
              ...currentModel,
              isLoading: true,
              error: null,
            });
            const loginEffect = pipe(
              tryTrpc<
                Awaited<ReturnType<typeof trpc.auth.login.mutate>>,
                LoginInvalidCredentialsError | LoginEmailNotVerifiedError
              >(
                () =>
                  trpc.auth.login.mutate({
                    email: currentModel.email,
                    password: currentModel.password,
                  }),
                {
                  UNAUTHORIZED: () => new LoginInvalidCredentialsError(),
                  FORBIDDEN: () => new LoginEmailNotVerifiedError(),
                },
              ),
              Effect.catchTag("UnknownTrpcError", (e) =>
                Effect.fail(new UnknownLoginError({ cause: e.cause })),
              ),
              Effect.match({
                onSuccess: (result) =>
                  propose({
                    type: "LOGIN_SUCCESS",
                    payload: result as LoginSuccessPayload,
                  }),
                onFailure: (error) =>
                  propose({ type: "LOGIN_ERROR", payload: error }),
              }),
            );
            yield* Effect.fork(loginEffect);
            break;
          }
          case "LOGIN_SUCCESS": {
            yield* clientLog(
              "info",
              `Login success for ${action.payload.user.email}`,
              action.payload.user.id,
              "LoginView:handleAction",
            );
            yield* Ref.set(model, { ...currentModel, isLoading: false });

            const { sessionId, user } = action.payload;
            const expires = new Date();
            expires.setDate(expires.getDate() + 30);
            document.cookie = `session_id=${sessionId}; path=/; expires=${expires.toUTCString()}; SameSite=Lax`;
            proposeAuthAction({ type: "SET_AUTHENTICATED", payload: user });
            break;
          }
          case "LOGIN_ERROR": {
            let errorMessage: string;
            switch (action.payload._tag) {
              case "LoginInvalidCredentialsError":
                errorMessage = "Incorrect email or password.";
                break;
              case "LoginEmailNotVerifiedError":
                errorMessage =
                  "Please verify your email address before logging in.";
                break;
              case "UnknownLoginError":
              default:
                errorMessage = "An unknown error occurred. Please try again.";
                break;
            }

            yield* clientLog(
              "error",
              `Login error: ${errorMessage}`,
              undefined,
              "LoginView:handleAction",
            );
            yield* Ref.set(model, {
              ...currentModel,
              isLoading: false,
              error: errorMessage,
            });
            break;
          }
        }
      });
    const renderEffect = Ref.get(model).pipe(
      Effect.tap((m) =>
        clientLog(
          "debug",
          `Rendering with state: ${JSON.stringify(m)}`,
          undefined,
          "LoginView:render",
        ),
      ),
      Effect.map(renderView),
    );
    // Initial render
    yield* renderEffect;
    // The main loop that drives the component
    const mainLoop = Queue.take(actionQueue).pipe(
      Effect.flatMap(handleAction), // Update state based on action
      Effect.andThen(renderEffect), // Re-render the UI with new state
      Effect.catchAllDefect((defect) =>
        clientLog(
          "error",
          `[FATAL] Uncaught defect in LoginView main loop: ${String(defect)}`,
        ),
      ),
      Effect.forever,
    );

    yield* mainLoop;
  });
  const fiber = runClientUnscoped(componentProgram);
  return {
    template: html`${container}`,
    cleanup: () => {
      runClientUnscoped(
        clientLog(
          "info",
          "LoginView cleaning up and interrupting fiber.",
          undefined,
          "LoginView:cleanup",
        ),
      );
      runClientUnscoped(Fiber.interrupt(fiber));
    },
  };
};
