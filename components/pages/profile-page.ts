// FILE: components/pages/profile-page.ts
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { authStore, type AuthModel } from "../../lib/client/stores/authStore";
import { effect } from "@preact/signals-core";
import tailwindStyles from "../../styles/main.css?inline";
import "../ui/notion-button-a11y.ts";

const sheet = new CSSStyleSheet();
sheet.replaceSync(tailwindStyles);

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

const update = (model: Model, action: Action): Model => {
  switch (action.type) {
    case "AUTH_STATE_CHANGED":
      return { ...model, auth: action.payload };
    case "UPLOAD_START":
      return { ...model, status: "uploading", error: null };
    case "UPLOAD_SUCCESS":
      const newUser = model.auth.user
        ? { ...model.auth.user, avatar_url: action.payload }
        : null;
      // This is slightly incorrect, as it modifies the store directly.
      // A better pattern would be to have authStore.propose be called from here.
      // But for simplicity, this works.
      if (newUser) {
        authStore.propose({ type: "SET_AUTHENTICATED", payload: newUser });
      }
      return { ...model, status: "idle" };
    case "UPLOAD_ERROR":
      return { ...model, status: "error", error: action.payload };
    default:
      return model;
  }
};

@customElement("profile-page")
export class ProfilePage extends LitElement {
  @state()
  private _model: Model = {
    auth: authStore.state,
    status: "idle",
    error: null,
  };

  private _unsubscribe?: () => void;

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot!.adoptedStyleSheets = [sheet];
    this._unsubscribe = effect(() => {
      this.propose({
        type: "AUTH_STATE_CHANGED",
        payload: authStore.stateSignal.value,
      });
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unsubscribe?.();
  }

  private propose(action: Action) {
    this._model = update(this._model, action);
    this.requestUpdate();
    void this.react(this._model, action);
  }

  private async react(model: Model, action: Action) {
    if (action.type === "UPLOAD_START") {
      const formData = new FormData();
      formData.append("avatar", action.payload);

      try {
        const response = await fetch("/api/user/avatar", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || "Upload failed");
        }

        const { avatarUrl } = await response.json();
        this.propose({ type: "UPLOAD_SUCCESS", payload: avatarUrl });
      } catch (e: unknown) {
        this.propose({
          type: "UPLOAD_ERROR",
          payload: e instanceof Error ? e.message : "An unknown error occurred",
        });
      }
    }
  }

  private _handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      this.propose({ type: "UPLOAD_START", payload: file });
    }
  }

  // --- NEW METHOD ---
  /**
   * Finds the hidden file input in the shadow DOM and triggers a click on it.
   */
  private _triggerFileInput() {
    const fileInput = this.shadowRoot?.getElementById(
      "avatar-upload",
    ) as HTMLInputElement;
    fileInput?.click();
  }
  // --- END OF NEW METHOD ---

  render() {
    const user = this._model.auth.user;
    if (!user)
      return html`
        <p>Loading...</p>
      `;

    const avatarSrc =
      user.avatar_url ||
      `https://ui-avatars.com/api/?name=${encodeURIComponent(user.email)}`;

    return html`
      <div class="mx-auto mt-6 max-w-lg p-4">
        <div class="rounded-lg border border-zinc-200 bg-white p-8 text-center">
          <h2 class="text-2xl font-bold text-zinc-900">Your Profile</h2>
          <div class="mt-6 flex flex-col items-center">
            <img
              src=${avatarSrc}
              alt="Profile avatar"
              class="h-32 w-32 rounded-full object-cover"
            />
            <p class="mt-4 text-lg font-medium">${user.email}</p>
          </div>

          <div class="mt-6">
            <!-- REMOVED the <label> tag -->
            <!-- MODIFIED the click handler -->
            <notion-button
              .loading=${this._model.status === "uploading"}
              @notion-button-click=${this._triggerFileInput}
            >
              ${this._model.status === "uploading"
                ? "Uploading..."
                : "Change Picture"}
            </notion-button>

            <input
              id="avatar-upload"
              type="file"
              class="hidden"
              accept="image/png, image/jpeg, image/webp"
              @change=${this._handleFileChange}
            />
          </div>

          ${this._model.status === "error"
            ? html`
                <p class="mt-4 text-sm text-red-500">${this._model.error}</p>
              `
            : ""}
        </div>
      </div>
    `;
  }
}
