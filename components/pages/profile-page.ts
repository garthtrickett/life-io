// File: components/pages/profile-page.ts
import { html, type TemplateResult } from "lit-html";
import { signal } from "@preact/signals-core";
import {
  authState,
  proposeAuthAction,
  type AuthModel,
} from "../../lib/client/stores/authStore";
import styles from "./ProfileView.module.css";
import "../ui/notion-button-a11y.ts";

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
    case "UPLOAD_SUCCESS":
      const user = model.value.auth.user
        ? { ...model.value.auth.user, avatar_url: action.payload }
        : null;
      if (user) proposeAuthAction({ type: "SET_AUTHENTICATED", payload: user });
      model.value = { ...model.value, status: "idle" };
      break;
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
      const { avatarUrl } = await response.json();
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

// Ensure initial state is correct if the page is loaded directly.
if (model.value.auth.status !== authState.value.status) {
  propose({ type: "AUTH_STATE_CHANGED", payload: authState.value });
}

// --- View Function ---
export const ProfileView = (): ViewResult => {
  // The subscription to the global auth store is set up when this view is rendered.
  // The router will call the returned `cleanup` function when we navigate away.
  const cleanup = authState.subscribe((newAuthState) => {
    propose({ type: "AUTH_STATE_CHANGED", payload: newAuthState });
  });

  const handleFileChange = (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) propose({ type: "UPLOAD_START", payload: file });
  };

  const triggerFileInput = () => {
    // Since this view is not in a Shadow DOM, we can safely query the document.
    document.getElementById("avatar-upload")?.click();
  };

  return {
    template: html`
      <div class=${styles.container}>
        <div class=${styles.profileCard}>
          <h2 class=${styles.title}>Your Profile</h2>
          <div class=${styles.avatarContainer}>
            <img
              src=${model.value.auth.user?.avatar_url ||
              `https://ui-avatars.com/api/?name=${encodeURIComponent(
                model.value.auth.user?.email ?? "User",
              )}`}
              alt="Profile avatar"
              class=${styles.avatar}
            />
            <p class=${styles.email}>${model.value.auth.user?.email}</p>
          </div>
          <div class=${styles.uploadSection}>
            <notion-button
              .loading=${model.value.status === "uploading"}
              @notion-button-click=${triggerFileInput}
            >
              ${model.value.status === "uploading"
                ? "Uploading..."
                : "Change Picture"}
            </notion-button>
            <input
              id="avatar-upload"
              type="file"
              class="hidden"
              @change=${handleFileChange}
              accept="image/*"
            />
          </div>
          ${model.value.error
            ? html`
                <p class=${styles.errorText}>${model.value.error}</p>
              `
            : ""}
        </div>
      </div>
    `,
    cleanup,
  };
};
