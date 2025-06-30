// components/pages/profile-page.ts
import { html, nothing, type TemplateResult } from "lit-html";
import { signal } from "@preact/signals-core";
import {
  authState,
  proposeAuthAction,
  type AuthModel,
} from "../../lib/client/stores/authStore";
import styles from "./ProfileView.module.css";
import { NotionButton } from "../ui/notion-button";
import { runClientUnscoped, runClientPromise } from "../../lib/client/runtime";
import { clientLog } from "../../lib/client/logger.client";
import { pipe, Effect, Exit, Cause } from "effect";
import { trpc } from "../../lib/client/trpc";
import { NotionInput } from "../ui/notion-input";

interface ViewResult {
  template: TemplateResult;
  cleanup?: () => void;
}

// --- UPDATED MODEL ---
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

// --- UPDATED ACTIONS ---
type Action =
  | { type: "AUTH_STATE_CHANGED"; payload: AuthModel }
  | { type: "UPLOAD_START"; payload: File }
  | { type: "UPLOAD_SUCCESS"; payload: string }
  | { type: "UPLOAD_ERROR"; payload: string }
  | { type: "TOGGLE_CHANGE_PASSWORD_FORM" }
  | { type: "UPDATE_OLD_PASSWORD"; payload: string }
  | { type: "UPDATE_NEW_PASSWORD"; payload: string }
  | { type: "UPDATE_CONFIRM_PASSWORD"; payload: string }
  | { type: "CHANGE_PASSWORD_START" }
  | { type: "CHANGE_PASSWORD_SUCCESS"; payload: string }
  | { type: "CHANGE_PASSWORD_ERROR"; payload: string };

const model = signal<Model>({
  auth: authState.value,
  status: "idle",
  message: null,
  loadingAction: null,
  isChangingPassword: false,
  oldPassword: "",
  newPassword: "",
  confirmPassword: "",
});

// --- UPDATED STATE REDUCER ---
const update = (action: Action) => {
  const currentModel = model.value;
  switch (action.type) {
    case "AUTH_STATE_CHANGED":
      model.value = {
        ...currentModel,
        auth: action.payload,
      };
      break;
    case "UPLOAD_START":
      model.value = {
        ...currentModel,
        status: "loading",
        loadingAction: "upload",
        message: null,
      };
      break;
    case "UPLOAD_SUCCESS": {
      const user = currentModel.auth.user
        ? { ...currentModel.auth.user, avatar_url: action.payload }
        : null;
      if (user) proposeAuthAction({ type: "SET_AUTHENTICATED", payload: user });
      model.value = {
        ...currentModel,
        status: "success",
        loadingAction: null,
        message: "Avatar updated!",
      };
      break;
    }
    case "UPLOAD_ERROR":
      model.value = {
        ...currentModel,
        status: "error",
        loadingAction: null,
        message: action.payload,
      };
      break;
    case "TOGGLE_CHANGE_PASSWORD_FORM":
      model.value = {
        ...currentModel,
        isChangingPassword: !currentModel.isChangingPassword,
        message: null,
        status: "idle",
        oldPassword: "",
        newPassword: "",
        confirmPassword: "",
      };
      break;
    case "UPDATE_OLD_PASSWORD":
      model.value = {
        ...currentModel,
        oldPassword: action.payload,
        message: null,
      };
      break;
    case "UPDATE_NEW_PASSWORD":
      model.value = {
        ...currentModel,
        newPassword: action.payload,
        message: null,
      };
      break;
    case "UPDATE_CONFIRM_PASSWORD":
      model.value = {
        ...currentModel,
        confirmPassword: action.payload,
        message: null,
      };
      break;
    case "CHANGE_PASSWORD_START":
      model.value = {
        ...currentModel,
        status: "loading",
        loadingAction: "changePassword",
        message: null,
      };
      break;
    case "CHANGE_PASSWORD_SUCCESS":
      model.value = {
        ...currentModel,
        status: "success",
        loadingAction: null,
        message: action.payload,
        isChangingPassword: false,
        oldPassword: "",
        newPassword: "",
        confirmPassword: "",
      };
      break;
    case "CHANGE_PASSWORD_ERROR":
      model.value = {
        ...currentModel,
        status: "error",
        loadingAction: null,
        message: action.payload,
      };
      break;
  }
};

// --- UPDATED SIDE EFFECTS ---
const react = async (action: Action) => {
  if (action.type === "UPLOAD_START") {
    const formData = new FormData();
    formData.append("avatar", action.payload);
    try {
      const response = await fetch("/api/user/avatar", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error(await response.text());
      const { avatarUrl } = (await response.json()) as { avatarUrl: string };
      propose({ type: "UPLOAD_SUCCESS", payload: avatarUrl });
    } catch (e) {
      propose({
        type: "UPLOAD_ERROR",
        payload: e instanceof Error ? e.message : "Upload failed",
      });
    }
  } else if (action.type === "CHANGE_PASSWORD_START") {
    const { oldPassword, newPassword, confirmPassword } = model.value;

    if (newPassword !== confirmPassword) {
      propose({
        type: "CHANGE_PASSWORD_ERROR",
        payload: "New passwords do not match.",
      });
      return;
    }

    const changePasswordEffect = pipe(
      Effect.tryPromise({
        try: () =>
          trpc.auth.changePassword.mutate({
            oldPassword,
            newPassword,
          }),
        catch: (err) =>
          new Error(
            err instanceof Error ? err.message : "An unknown error occurred.",
          ),
      }),
      Effect.tap(() =>
        clientLog(
          "info",
          `Password change successful for user.`,
          model.value.auth.user!.id,
          "ProfileView:react",
        ),
      ),
    );

    const exit = await runClientPromise(Effect.exit(changePasswordEffect));

    if (Exit.isSuccess(exit)) {
      propose({
        type: "CHANGE_PASSWORD_SUCCESS",
        payload: "Password changed successfully!",
      });
    } else {
      const error = Cause.squash(exit.cause);
      const errorMessage =
        error instanceof Error
          ? error.message
          : "An unknown error occurred during password change.";
      propose({ type: "CHANGE_PASSWORD_ERROR", payload: errorMessage });
    }
  }
};

const propose = (action: Action) => {
  runClientUnscoped(
    clientLog(
      "debug",
      `ProfileView: Proposing action ${action.type}`,
      model.value.auth.user?.id,
      "ProfileView:propose",
    ),
  );
  update(action);
  void react(action);
};

if (model.value.auth.status !== authState.value.status) {
  propose({ type: "AUTH_STATE_CHANGED", payload: authState.value });
}

export const ProfileView = (): ViewResult => {
  const cleanup = authState.subscribe((newAuthState) => {
    propose({ type: "AUTH_STATE_CHANGED", payload: newAuthState });
  });

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

  const passwordChangeForm = html`
    <form @submit=${onPasswordSubmit} class="mt-6 space-y-4 text-left">
      ${NotionInput({
        id: "oldPassword",
        label: "Old Password",
        type: "password",
        value: model.value.oldPassword,
        onInput: (e: Event) =>
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
        value: model.value.newPassword,
        onInput: (e: Event) =>
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
        value: model.value.confirmPassword,
        onInput: (e: Event) =>
          propose({
            type: "UPDATE_CONFIRM_PASSWORD",
            payload: (e.target as HTMLInputElement).value,
          }),
        required: true,
      })}
      <div class="flex items-center gap-4 pt-2">
        ${NotionButton({
          children:
            model.value.loadingAction === "changePassword"
              ? "Saving..."
              : "Save Password",
          type: "submit",
          loading: model.value.loadingAction === "changePassword",
          disabled: model.value.status === "loading",
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

  const user = model.value.auth.user;
  if (!user) {
    return { template: html`<p>Loading profile...</p>`, cleanup };
  }

  const avatarUrl =
    user.avatar_url ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(user.email)}`;

  return {
    template: html`
      <div class=${styles.container}>
        <div class=${styles.profileCard}>
          <h2 class=${styles.title}>Your Profile</h2>

          ${model.value.message
            ? html`<div
                class="${model.value.status === "success"
                  ? "bg-green-100 text-green-700"
                  : "bg-red-100 text-red-700"} mt-4 rounded-md p-4 text-center text-sm"
              >
                <p>${model.value.message}</p>
              </div>`
            : nothing}
          <div class=${styles.avatarContainer}>
            <img src=${avatarUrl} alt="Profile avatar" class=${styles.avatar} />
            <p class=${styles.email}>${user.email}</p>
          </div>
          <div class=${styles.uploadSection}>
            ${model.value.isChangingPassword
              ? passwordChangeForm
              : html`
                  <div class="mt-4 flex flex-col items-center gap-4">
                    ${NotionButton({
                      children:
                        model.value.loadingAction === "upload"
                          ? "Uploading..."
                          : "Change Picture",
                      loading: model.value.loadingAction === "upload",
                      onClick: triggerFileInput,
                      disabled: model.value.status === "loading",
                    })}
                    ${NotionButton({
                      children: "Change Password",
                      onClick: () =>
                        propose({ type: "TOGGLE_CHANGE_PASSWORD_FORM" }),
                      disabled: model.value.status === "loading",
                    })}
                  </div>
                `}

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
    `,
    cleanup: () => {
      model.value = {
        auth: authState.value,
        status: "idle",
        message: null,
        loadingAction: null,
        isChangingPassword: false,
        oldPassword: "",
        newPassword: "",
        confirmPassword: "",
      };
    },
  };
};
