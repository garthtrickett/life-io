// File: ./components/pages/profile-page.ts
import { render, html, nothing, type TemplateResult } from "lit-html";
import {
  authState,
  proposeAuthAction,
  type AuthModel,
} from "../../lib/client/stores/authStore";
import styles from "./ProfileView.module.css";
import { NotionButton } from "../ui/notion-button";
import { runClientUnscoped } from "../../lib/client/runtime";
import { clientLog } from "../../lib/client/logger.client";
import { pipe, Effect, Data, Ref, Queue, Fiber, Stream } from "effect";
import { trpc } from "../../lib/client/trpc";
import { NotionInput } from "../ui/notion-input";

interface ViewResult {
  template: TemplateResult;
  cleanup?: () => void;
}

// --- START OF FIX: Define specific tagged errors for different failures ---
class AvatarUploadError extends Data.TaggedError("AvatarUploadError")<{
  readonly message: string;
}> {}
class ChangePasswordIncorrectPasswordError extends Data.TaggedError(
  "ChangePasswordIncorrectPasswordError",
) {}
class UnknownChangePasswordError extends Data.TaggedError(
  "UnknownChangePasswordError",
)<{
  readonly cause: unknown;
}> {}
// --- END OF FIX ---

// --- Model ---
interface Model {
  auth: AuthModel;
  status: "idle" | "loading" | "success" | "error";
  message: string | null;
  loadingAction: "upload" | "changePassword" | null;
  isChangingPassword: boolean;
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

// --- Actions ---
// --- FIX: Update Action type to use the new tagged errors ---
type Action =
  | { type: "AUTH_STATE_CHANGED"; payload: AuthModel }
  | { type: "UPLOAD_START"; payload: File }
  | { type: "UPLOAD_SUCCESS"; payload: string }
  | { type: "UPLOAD_ERROR"; payload: AvatarUploadError }
  | { type: "TOGGLE_CHANGE_PASSWORD_FORM" }
  | { type: "UPDATE_OLD_PASSWORD"; payload: string }
  | { type: "UPDATE_NEW_PASSWORD"; payload: string }
  | { type: "UPDATE_CONFIRM_PASSWORD"; payload: string }
  | { type: "CHANGE_PASSWORD_START" }
  | { type: "CHANGE_PASSWORD_SUCCESS"; payload: string }
  | {
      type: "CHANGE_PASSWORD_ERROR";
      payload:
        | ChangePasswordIncorrectPasswordError
        | UnknownChangePasswordError;
    };

// --- View ---
export const ProfileView = (): ViewResult => {
  const container = document.createElement("div");
  const componentProgram = Effect.gen(function* () {
    // --- State & Action Queue ---
    const model = yield* Ref.make<Model>({
      auth: authState.value,
      status: "idle",
      message: null,
      loadingAction: null,
      isChangingPassword: false,
      oldPassword: "",
      newPassword: "",
      confirmPassword: "",
    });
    const actionQueue = yield* Queue.unbounded<Action>();

    // --- Propose Action ---
    const propose = (action: Action) =>
      Effect.runFork(
        pipe(
          clientLog(
            "debug",
            `ProfileView: Proposing action ${action.type}`,
            undefined,
            "ProfileView:propose",
          ),
          Effect.andThen(() => Queue.offer(actionQueue, action)),
        ),
      );

    // --- Action Handler ---
    const handleAction = (action: Action): Effect.Effect<void> =>
      Effect.gen(function* () {
        const currentModel = yield* Ref.get(model);
        switch (action.type) {
          case "AUTH_STATE_CHANGED":
            yield* Ref.update(
              model,
              (m): Model => ({ ...m, auth: action.payload }),
            );
            break;

          case "UPLOAD_START": {
            yield* Ref.update(
              model,
              (m): Model => ({
                ...m,
                status: "loading",
                loadingAction: "upload",
                message: null,
              }),
            );
            const formData = new FormData();
            formData.append("avatar", action.payload);
            const uploadEffect = pipe(
              Effect.tryPromise({
                try: () =>
                  fetch("/api/user/avatar", { method: "POST", body: formData }),
                catch: (cause) =>
                  new AvatarUploadError({ message: String(cause) }),
              }),
              Effect.flatMap((response) =>
                response.ok
                  ? Effect.tryPromise({
                      try: () =>
                        response.json() as Promise<{ avatarUrl: string }>,
                      catch: (cause) =>
                        new AvatarUploadError({ message: String(cause) }),
                    })
                  : Effect.promise(async () => response.text()).pipe(
                      Effect.flatMap((text) =>
                        Effect.fail(
                          new AvatarUploadError({
                            message: text || "Upload failed",
                          }),
                        ),
                      ),
                    ),
              ),
              Effect.match({
                onSuccess: (json) =>
                  propose({ type: "UPLOAD_SUCCESS", payload: json.avatarUrl }),
                onFailure: (error) =>
                  propose({ type: "UPLOAD_ERROR", payload: error }),
              }),
            );
            yield* Effect.fork(uploadEffect);
            break;
          }

          case "UPLOAD_SUCCESS": {
            const user = currentModel.auth.user
              ? { ...currentModel.auth.user, avatar_url: action.payload }
              : null;
            if (user)
              proposeAuthAction({ type: "SET_AUTHENTICATED", payload: user });
            yield* Ref.update(
              model,
              (m): Model => ({
                ...m,
                status: "success",
                loadingAction: null,
                message: "Avatar updated!",
              }),
            );
            break;
          }

          case "UPLOAD_ERROR":
            yield* Ref.update(
              model,
              (m): Model => ({
                ...m,
                status: "error",
                loadingAction: null,
                message: action.payload.message,
              }),
            );
            break;

          case "TOGGLE_CHANGE_PASSWORD_FORM":
            yield* Ref.update(
              model,
              (m): Model => ({
                ...m,
                isChangingPassword: !m.isChangingPassword,
                message: null,
                status: "idle",
                oldPassword: "",
                newPassword: "",
                confirmPassword: "",
              }),
            );
            break;

          case "UPDATE_OLD_PASSWORD":
            yield* Ref.update(
              model,
              (m): Model => ({
                ...m,
                oldPassword: action.payload,
                message: null,
              }),
            );
            break;

          case "UPDATE_NEW_PASSWORD":
            yield* Ref.update(
              model,
              (m): Model => ({
                ...m,
                newPassword: action.payload,
                message: null,
              }),
            );
            break;

          case "UPDATE_CONFIRM_PASSWORD":
            yield* Ref.update(
              model,
              (m): Model => ({
                ...m,
                confirmPassword: action.payload,
                message: null,
              }),
            );
            break;

          case "CHANGE_PASSWORD_START": {
            if (currentModel.newPassword !== currentModel.confirmPassword) {
              propose({
                type: "CHANGE_PASSWORD_ERROR",
                payload: new UnknownChangePasswordError({
                  cause: "New passwords do not match.",
                }), // Re-using for simplicity
              });
              return;
            }
            yield* Ref.update(
              model,
              (m): Model => ({
                ...m,
                status: "loading",
                loadingAction: "changePassword",
                message: null,
              }),
            );
            // --- START OF FIX: The `catch` block now inspects the TRPC error ---
            const changePasswordEffect = pipe(
              Effect.tryPromise({
                try: () =>
                  trpc.auth.changePassword.mutate({
                    oldPassword: currentModel.oldPassword,
                    newPassword: currentModel.newPassword,
                  }),
                catch: (err) => {
                  if (
                    typeof err === "object" &&
                    err !== null &&
                    "data" in err &&
                    (err.data as { code?: string }).code === "BAD_REQUEST"
                  ) {
                    return new ChangePasswordIncorrectPasswordError();
                  }
                  return new UnknownChangePasswordError({ cause: err });
                },
              }),
              Effect.match({
                onSuccess: () =>
                  propose({
                    type: "CHANGE_PASSWORD_SUCCESS",
                    payload: "Password changed successfully!",
                  }),
                onFailure: (error) =>
                  propose({
                    type: "CHANGE_PASSWORD_ERROR",
                    payload: error,
                  }),
              }),
            );
            // --- END OF FIX ---
            yield* Effect.fork(changePasswordEffect);
            break;
          }

          case "CHANGE_PASSWORD_SUCCESS":
            yield* Ref.update(
              model,
              (m): Model => ({
                ...m,
                status: "success",
                loadingAction: null,
                message: action.payload,
                isChangingPassword: false,
                oldPassword: "",
                newPassword: "",
                confirmPassword: "",
              }),
            );
            break;

          // --- START OF FIX: Handle specific tagged errors to show the correct message ---
          case "CHANGE_PASSWORD_ERROR": {
            let errorMessage: string;
            switch (action.payload._tag) {
              case "ChangePasswordIncorrectPasswordError":
                errorMessage = "Incorrect old password provided.";
                break;
              case "UnknownChangePasswordError":
              default:
                errorMessage = "An unknown error occurred. Please try again.";
                break;
            }
            yield* Ref.update(
              model,
              (m): Model => ({
                ...m,
                status: "error",
                loadingAction: null,
                message: errorMessage,
              }),
            );
            break;
          }
          // --- END OF FIX ---
        }
      });

    // --- Render ---
    const renderView = (m: Model) => {
      const user = m.auth.user;
      if (!user) {
        render(html`<p>Loading profile...</p>`, container);
        return;
      }
      const handleFileChange = (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) propose({ type: "UPLOAD_START", payload: file });
      };
      const triggerFileInput = () => {
        document.getElementById("avatar-upload")?.click();
      };
      const onPasswordSubmit = (e: Event) => {
        e.preventDefault();
        propose({ type: "CHANGE_PASSWORD_START" });
      };
      const avatarUrl =
        user.avatar_url ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(user.email)}`;
      const passwordChangeForm = html`
        <form @submit=${onPasswordSubmit} class="mt-6 space-y-4 text-left">
          ${NotionInput({
            id: "oldPassword",
            label: "Old Password",
            type: "password",
            value: m.oldPassword,
            onInput: (e) =>
              propose({
                type: "UPDATE_OLD_PASSWORD",
                payload: (e.target as HTMLInputElement).value,
              }),
            required: true,
          })}
          ${NotionInput({
            id: "newPassword",
            label: "New Password (min. 8 characters)",
            type: "password",
            value: m.newPassword,
            onInput: (e) =>
              propose({
                type: "UPDATE_NEW_PASSWORD",
                payload: (e.target as HTMLInputElement).value,
              }),
            required: true,
          })}
          ${NotionInput({
            id: "confirmPassword",
            label: "Confirm New Password",
            type: "password",
            value: m.confirmPassword,
            onInput: (e) =>
              propose({
                type: "UPDATE_CONFIRM_PASSWORD",
                payload: (e.target as HTMLInputElement).value,
              }),
            required: true,
          })}
          <div class="flex items-center gap-4 pt-2">
            ${NotionButton({
              children:
                m.loadingAction === "changePassword"
                  ? "Saving..."
                  : "Save Password",
              type: "submit",
              loading: m.loadingAction === "changePassword",
              disabled: m.status === "loading",
            })}
            <button
              type="button"
              @click=${() => propose({ type: "TOGGLE_CHANGE_PASSWORD_FORM" })}
              class="text-sm font-medium text-zinc-600 hover:text-zinc-500"
            >
              Cancel
            </button>
          </div>
        </form>
      `;
      const template = html`
        <div class=${styles.container}>
          <div class=${styles.profileCard}>
            <h2 class=${styles.title}>Your Profile</h2>
            ${m.message
              ? html`<div
                  class="${m.status === "success"
                    ? "bg-green-100 text-green-700"
                    : "bg-red-100 text-red-700"} mt-4 rounded-md p-4 text-center text-sm"
                >
                  <p>${m.message}</p>
                </div>`
              : nothing}
            <div class=${styles.avatarContainer}>
              <img
                src=${avatarUrl}
                alt="Profile avatar"
                class=${styles.avatar}
              />
              <p class=${styles.email}>${user.email}</p>
            </div>
            <div class=${styles.uploadSection}>
              ${m.isChangingPassword
                ? passwordChangeForm
                : html`<div class="mt-4 flex flex-col items-center gap-4">
                    ${NotionButton({
                      children:
                        m.loadingAction === "upload"
                          ? "Uploading..."
                          : "Change Picture",
                      loading: m.loadingAction === "upload",
                      onClick: triggerFileInput,
                      disabled: m.status === "loading",
                    })}
                    ${NotionButton({
                      children: "Change Password",
                      onClick: () =>
                        propose({ type: "TOGGLE_CHANGE_PASSWORD_FORM" }),
                      disabled: m.status === "loading",
                    })}
                  </div>`}
              <input
                id="avatar-upload"
                type="file"
                class="hidden"
                @change=${handleFileChange}
                accept="image/*"
              />
            </div>
          </div>
        </div>
      `;
      render(template, container);
    };

    const renderEffect = Ref.get(model).pipe(
      Effect.tap((m) =>
        clientLog(
          "debug",
          `Rendering ProfileView with state: ${JSON.stringify(m)}`,
          m.auth.user?.id,
          "ProfileView:render",
        ),
      ),
      Effect.tap(renderView),
    );
    // --- Main Loop ---
    const authStreamEffect = Stream.async<never>(() => {
      const unsubscribe = authState.subscribe((newAuthState) => {
        runClientUnscoped(
          propose({ type: "AUTH_STATE_CHANGED", payload: newAuthState }),
        );
      });
      // The effect returned here is the cleanup logic for the stream
      return Effect.sync(unsubscribe);
    }).pipe(Stream.runDrain, Effect.fork);
    yield* authStreamEffect;
    yield* renderEffect; // Initial render

    const mainLoop = Queue.take(actionQueue).pipe(
      Effect.flatMap(handleAction),
      Effect.andThen(renderEffect),
      Effect.catchAllDefect((defect) =>
        clientLog(
          "error",
          `[FATAL] Uncaught defect in ProfileView main loop: ${String(defect)}`,
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
          "ProfileView cleanup running, interrupting fiber.",
          undefined,
          "ProfileView:cleanup",
        ),
      );
      runClientUnscoped(Fiber.interrupt(fiber));
    },
  };
};
