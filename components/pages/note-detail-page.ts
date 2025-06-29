// File: ./components/pages/note-detail-page.ts
// UPDATE: Added a disconnectedCallback to clean up pending timers.
import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Effect, pipe } from "effect";
import { PageAnimationMixin } from "../mixins/page-animation-mixin.ts";
import { clientLog } from "../../lib/client/logger.client";
import { trpc } from "../../lib/client/trpc";
import { authStore } from "../../lib/client/stores/authStore";
import type { NoteDto } from "../../types/generated/Note";
import tailwindStyles from "../../styles/main.css?inline";
import "../ui/skeleton-loader.ts";

const sheet = new CSSStyleSheet();
sheet.replaceSync(tailwindStyles);

// --- SAM (State-Action-Model) Pattern Definition ---

interface Model {
  status: "loading" | "idle" | "saving" | "saved" | "error";
  note: NoteDto | null;
  error: string | null;
}

type Action =
  | { type: "FETCH_START" }
  | { type: "FETCH_SUCCESS"; payload: NoteDto }
  | { type: "FETCH_ERROR"; payload: string }
  | { type: "UPDATE_TITLE"; payload: string }
  | { type: "UPDATE_CONTENT"; payload: string }
  | { type: "SAVE_START" }
  | { type: "SAVE_SUCCESS"; payload: NoteDto }
  | { type: "SAVE_ERROR"; payload: string }
  | { type: "RESET_SAVE_STATUS" };

const update = (model: Model, action: Action): Model => {
  switch (action.type) {
    case "FETCH_START":
      return { ...model, status: "loading", error: null };
    case "FETCH_SUCCESS":
      return { ...model, status: "idle", note: action.payload };
    case "FETCH_ERROR":
      return { ...model, status: "error", error: action.payload, note: null };
    case "UPDATE_TITLE":
      if (!model.note) return model;
      // Clear error when user starts typing again
      return {
        ...model,
        status: "idle",
        error: null,
        note: { ...model.note, title: action.payload },
      };
    case "UPDATE_CONTENT":
      if (!model.note) return model;
      return { ...model, note: { ...model.note, content: action.payload } };
    case "SAVE_START":
      return { ...model, status: "saving", error: null };
    case "SAVE_SUCCESS":
      return { ...model, status: "saved", note: action.payload };
    case "SAVE_ERROR":
      return { ...model, status: "error", error: action.payload };
    case "RESET_SAVE_STATUS":
      return { ...model, status: "idle" };
    default:
      return model;
  }
};

@customElement("note-detail-page")
export class NoteDetailPage extends PageAnimationMixin(LitElement) {
  @property({ type: String })
  noteId: string = "";

  @state()
  private _model: Model = {
    status: "loading",
    note: null,
    error: null,
  };

  private _updateTimeout: number | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot!.adoptedStyleSheets = [sheet];
    this.propose({ type: "FETCH_START" });
  }

  // --- FIX: Clean up timers when the component is removed from the DOM ---
  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._updateTimeout) {
      clearTimeout(this._updateTimeout);
    }
  }

  private propose(action: Action) {
    this._model = update(this._model, action);
    this.requestUpdate();
    // FIX: Handle floating promise for the async `react` method
    void this.react(this._model, action);
  }

  private async react(model: Model, action: Action) {
    switch (action.type) {
      // FIX: Add block scope to the case to allow lexical declarations
      case "FETCH_START": {
        const fetchEffect = pipe(
          Effect.tryPromise({
            try: () => trpc.note.getById.query({ id: this.noteId }),
            // FIX: Safely convert unknown error to string
            catch: (e) => new Error(`Failed to fetch note: ${String(e)}`),
          }),
          Effect.tap((note) =>
            clientLog(
              "info",
              `Fetched note: ${note?.title}`, // Use authStore for the user ID
              authStore.state.user?.id,
              "NoteDetail",
            ),
          ),
          Effect.match({
            onSuccess: (note) => {
              if (note) {
                this.propose({
                  type: "FETCH_SUCCESS",
                  payload: note as NoteDto,
                });
              } else {
                this.propose({
                  type: "FETCH_ERROR",
                  payload: "Note not found or permission denied.",
                });
              }
            },
            onFailure: (error) =>
              this.propose({ type: "FETCH_ERROR", payload: error.message }),
          }),
        );
        await Effect.runPromise(fetchEffect);
        break;
      }

      case "UPDATE_TITLE":
      case "UPDATE_CONTENT":
        if (this._updateTimeout) clearTimeout(this._updateTimeout);
        this._updateTimeout = window.setTimeout(() => {
          this.propose({ type: "SAVE_START" });
        }, 500); // Debounce time
        break;

      // FIX: Add block scope to the case to allow lexical declarations
      case "SAVE_START": {
        if (!model.note) return;

        if (model.note.title.trim().length === 0) {
          this.propose({
            type: "SAVE_ERROR",
            payload: "Title cannot be empty.",
          });
          return;
        }

        const { title, content } = model.note;
        const updateEffect = pipe(
          Effect.tryPromise({
            try: () =>
              trpc.note.update.mutate({ id: this.noteId, title, content }),
            // FIX: Safely convert unknown error to string
            catch: (e) => new Error(`Failed to save note: ${String(e)}`),
          }),
          Effect.tap((updatedNote) =>
            clientLog(
              "info",
              `Note "${updatedNote?.title}" updated.`, // Use authStore for the user ID
              authStore.state.user?.id,
              "NoteDetail",
            ),
          ),
          Effect.match({
            onSuccess: (updatedNote) => {
              if (updatedNote) {
                this.propose({
                  type: "SAVE_SUCCESS",
                  payload: updatedNote as NoteDto,
                });
              }
            },
            onFailure: (error) =>
              this.propose({ type: "SAVE_ERROR", payload: error.message }),
          }),
        );
        await Effect.runPromise(updateEffect);
        break;
      }

      case "SAVE_SUCCESS":
        setTimeout(() => this.propose({ type: "RESET_SAVE_STATUS" }), 2000);
        break;
    }
  }

  renderStatus() {
    switch (this._model.status) {
      case "saving":
        return html`
          <div class="text-sm text-zinc-500">Saving...</div>
        `;
      case "saved":
        return html`
          <div class="text-sm text-green-600">Saved</div>
        `;
      case "error":
        return html`
          <div class="text-sm text-red-600">Error: ${this._model.error}</div>
        `;
      default:
        return html`
          <div class="h-5"></div>
        `;
    }
  }

  render() {
    if (this._model.status === "loading") {
      return html`
        <div class="mx-auto mt-6 max-w-4xl p-8"></div>
      `;
    }

    if (!this._model.note) {
      return html`
        <div class="p-8 text-center text-red-500">
          ${this._model.error || "Note could not be loaded."}
        </div>
      `;
    }

    return html`
      <div class="mx-auto mt-6 max-w-4xl">
        <div class="p-8">
          <div class="mb-4 flex items-center justify-between">
            <h2 class="text-lg font-semibold text-zinc-800">Edit Note</h2>
            <div class="w-36 text-right">${this.renderStatus()}</div>
          </div>
          <input
            type="text"
            .value=${this._model.note.title}
            @input=${(e: Event) =>
              this.propose({
                type: "UPDATE_TITLE",
                payload: (e.target as HTMLInputElement).value,
              })}
            placeholder="Your Title"
            class="mb-4 w-full bg-transparent text-4xl font-bold text-zinc-900 focus:outline-none"
          />
          <textarea
            .value=${this._model.note.content}
            @input=${(e: Event) =>
              this.propose({
                type: "UPDATE_CONTENT",
                payload: (e.target as HTMLTextAreaElement).value,
              })}
            placeholder="Just start writing..."
            class="min-h-[60vh] w-full resize-none bg-transparent text-lg text-zinc-700 focus:outline-none"
          ></textarea>
        </div>
      </div>
    `;
  }
}
