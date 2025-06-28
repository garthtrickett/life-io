// File: ./components/my-note-form.ts
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Effect, pipe } from "effect";
import { clientLog } from "../lib/client/logger.client.js";
import { trpc } from "../lib/client/trpc.js";
import "./notion-button-a11y.ts";

// --- SAM Pattern Implementation ---

// 1. Model: Represents the state of the application.
//    MODIFIED: Now includes `title` and `content` to manage form inputs.
interface Model {
  status: "idle" | "submitting" | "success" | "error";
  error: string | null;
  userId: string;
  title: string;
  content: string;
}

// 2. Actions: Represent the user's intentions.
//    MODIFIED: Added actions to update form fields.
type Action =
  | { type: "UPDATE_TITLE"; payload: string }
  | { type: "UPDATE_CONTENT"; payload: string }
  | { type: "SUBMIT_START" }
  | { type: "SUBMIT_SUCCESS" }
  | { type: "SUBMIT_ERROR"; payload: string }
  | { type: "RESET" };

// 3. Update: A function that computes the new model based on the current model and an action.
//    MODIFIED: Handles new actions to update the model.
const update = (model: Model, action: Action): Model => {
  switch (action.type) {
    case "UPDATE_TITLE":
      return { ...model, title: action.payload };
    case "UPDATE_CONTENT":
      return { ...model, content: action.payload };
    case "SUBMIT_START":
      return { ...model, status: "submitting", error: null };
    case "SUBMIT_SUCCESS":
      // On success, clear the form fields in the model.
      return { ...model, status: "success", title: "", content: "" };
    case "SUBMIT_ERROR":
      return { ...model, status: "error", error: action.payload };
    case "RESET":
      return { ...model, status: "idle", error: null };
    default:
      return model;
  }
};

// --- Original Code with modifications for SAM Pattern ---

import tailwindStyles from "../styles/main.css?inline";

const sheet = new CSSStyleSheet();
sheet.replaceSync(tailwindStyles);

@customElement("my-note-form")
export class MyNoteForm extends LitElement {
  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot!.adoptedStyleSheets = [sheet];
  }

  // MODIFIED: The model now includes initial empty values for the form fields.
  @state()
  private _model: Model = {
    status: "idle",
    error: null,
    userId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    title: "",
    content: "",
  };

  private present(action: Action) {
    this._model = update(this._model, action);
  }

  private async _handleSubmit(e?: Event) {
    e?.preventDefault?.();

    // MODIFIED: Get title and content directly from the model, not the DOM.
    const { userId, title, content } = this._model;

    if (!title) {
      this.present({ type: "SUBMIT_ERROR", payload: "Title is required." });
      return;
    }

    this.present({ type: "SUBMIT_START" });

    const noteData = { user_id: userId, title, content };

    const createNoteApiCall = Effect.tryPromise({
      try: () => trpc.note.createNote.mutate(noteData),
      catch: (error: any) => new Error(`tRPC Mutation Error: ${error.message}`),
    });

    const program = pipe(
      clientLog(
        "info",
        `User attempting to create note: "${title}"`,
        userId,
        "NoteCreation",
      ),
      Effect.andThen(() => createNoteApiCall),
      Effect.tap((response) => {
        // Dispatch success action, which will also clear form fields in the model.
        this.present({ type: "SUBMIT_SUCCESS" });
        setTimeout(() => {
          if (this._model.status === "success") this.present({ type: "RESET" });
        }, 3000);
        return clientLog(
          "info",
          `Successfully created note via tRPC. Response ID: ${response?.id}`,
          userId,
          "NoteCreation",
        );
      }),
      Effect.catchAll((error) => {
        const errorMessage = error.message || "An unknown error occurred.";
        this.present({ type: "SUBMIT_ERROR", payload: errorMessage });
        setTimeout(() => {
          if (this._model.status === "error") this.present({ type: "RESET" });
        }, 3000);
        return pipe(
          clientLog(
            "error",
            `Failed to create note via tRPC: ${errorMessage}`,
            userId,
            "NoteCreation",
          ),
          Effect.andThen(() => Effect.void),
        );
      }),
    );
    await Effect.runPromise(program);
  }

  // MODIFIED: Event handlers for input fields to update the model.
  private _handleTitleInput(e: Event) {
    const title = (e.target as HTMLInputElement).value;
    this.present({ type: "UPDATE_TITLE", payload: title });
  }

  private _handleContentInput(e: Event) {
    const content = (e.target as HTMLTextAreaElement).value;
    this.present({ type: "UPDATE_CONTENT", payload: content });
  }

  render() {
    return html`
      <div class="max-w-2xl mx-auto mt-6">
        <div class="bg-white border border-zinc-200 rounded-lg p-8">
          <h2 class="text-2xl font-bold text-zinc-900 mb-4">
            Create a New Note
          </h2>
          <form class="flex flex-col gap-4">
            <input
              name="title"
              placeholder="Note Title"
              required
              .value=${this._model.title}
              @input=${this._handleTitleInput}
              .disabled=${this._model.status === "submitting"}
              class="w-full px-3 py-2 border border-zinc-300 rounded-md"
            />
            <textarea
              name="content"
              placeholder="Your thoughts go here..."
              required
              .value=${this._model.content}
              @input=${this._handleContentInput}
              .disabled=${this._model.status === "submitting"}
              class="w-full px-3 py-2 border border-zinc-300 rounded-md min-h-[120px]"
            ></textarea>
            <notion-button
              class="self-end"
              .loading=${this._model.status === "submitting"}
              @notion-button-click=${this._handleSubmit}
            >
              ${this._model.status === "submitting"
                ? "Creating…"
                : "Create Note"}
            </notion-button>
            ${this._model.status === "error"
              ? html`<div
                  class="mt-4 p-3 rounded-md bg-red-100 text-red-800 border border-red-200"
                >
                  Error: ${this._model.error}
                </div>`
              : ""}
            ${this._model.status === "success"
              ? html`<div
                  class="mt-4 p-3 rounded-md bg-green-100 text-green-800 border border-green-200"
                >
                  Note created successfully!
                </div>`
              : ""}
          </form>
        </div>
      </div>
    `;
  }
}
