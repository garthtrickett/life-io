// File: components/pages/profile-page.ts
import { html, nothing, type TemplateResult } from "lit-html";
import { signal } from "@preact/signals-core";
import {
  authState,
  proposeAuthAction,
  type AuthModel,
} from "../../lib/client/stores/authStore";
import styles from "./ProfileView.module.css";
import { NotionButton } from "../ui/notion-button"; // <-- 1. Import the new button component

// --- Types ---
interface ViewResult {
  template: TemplateResult;
  cleanup?: () => void;
}
interface Model {
  auth: AuthModel;
  status: "idle" | "uploading" | "error";
  error: string | null;
}
type Action =
  | { type: "AUTH_STATE_CHANGED"; payload: AuthModel }
  | { type: "UPLOAD_START"; payload: File }
  | { type: "UPLOAD_SUCCESS"; payload: string }
  | { type: "UPLOAD_ERROR"; payload: string };

// --- Module-level state and logic ---
const model = signal<Model>({
  auth: authState.value,
  status: "idle",
  error: null,
});

const update = (action: Action) => {
  switch (action.type) {
    case "AUTH_STATE_CHANGED":
      model.value = { ...model.value, auth: action.payload };
      break;
    case "UPLOAD_START":
      model.value = { ...model.value, status: "uploading", error: null };
      break;
    case "UPLOAD_SUCCESS": {
      const user = model.value.auth.user
        ? { ...model.value.auth.user, avatar_url: action.payload }
        : null;
      if (user) proposeAuthAction({ type: "SET_AUTHENTICATED", payload: user });
      model.value = { ...model.value, status: "idle" };
      break;
    }
    case "UPLOAD_ERROR":
      model.value = {
        ...model.value,
        status: "error",
        error: action.payload,
      };
      break;
  }
};

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
  }
};

const propose = (action: Action) => {
  update(action);
  void react(action);
};

// This ensures the local model is in sync with the global auth store
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
    // This function now just handles the logic, to be passed to the button's onClick.
    document.getElementById("avatar-upload")?.click();
  };

  const user = model.value.auth.user;
  if (!user) {
    // Handle case where user is not logged in, maybe show a loading or error state
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
          <div class=${styles.avatarContainer}>
            <img src=${avatarUrl} alt="Profile avatar" class=${styles.avatar} />
            <p class=${styles.email}>${user.email}</p>
          </div>
          <div class=${styles.uploadSection}>
            ${NotionButton({
              children:
                model.value.status === "uploading"
                  ? "Uploading..."
                  : "Change Picture",
              loading: model.value.status === "uploading",
              onClick: triggerFileInput,
            })}
            <input
              id="avatar-upload"
              type="file"
              class="hidden"
              @change=${handleFileChange}
              accept="image/*"
            />
          </div>
          ${model.value.error
            ? html`<p class=${styles.errorText}>${model.value.error}</p>`
            : nothing}
        </div>
      </div>
    `,
    cleanup,
  };
};
