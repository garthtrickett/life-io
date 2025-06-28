// File: ./components/my-note-form.ts
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Effect, pipe } from "effect";
import { clientLog } from "../lib/client/logger.client.js";
import { trpc } from "../lib/client/trpc.js";
import "./notion-button-a11y.ts";

// --- SAM (State-Action-Model) Pattern with Effects ---

// 1. Model: The complete state of the application.
interface Model {
  status: "idle" | "submitting" | "success" | "error";
  error: string | null;
  userId: string;
  title: string;
  content: string;
}

// 2. Actions: All possible intentions that can change the state.
type Action =
  | { type: "UPDATE_TITLE"; payload: string }
  | { type: "UPDATE_CONTENT"; payload: string }
  | { type: "SUBMIT_START" }
  | { type: "SUBMIT_SUCCESS" }
  | { type: "SUBMIT_ERROR"; payload: string }
  | { type: "RESET_STATUS" };

// 3. Update: A PURE function to calculate the next state. It does NOT perform side effects.
const update = (model: Model, action: Action): Model => {
  switch (action.type) {
    case "UPDATE_TITLE":
      return { ...model, title: action.payload };
    case "UPDATE_CONTENT":
      return { ...model, content: action.payload };
    case "SUBMIT_START":
      // Validation happens before this action is proposed.
      return { ...model, status: "submitting", error: null };
    case "SUBMIT_SUCCESS":
      return { ...model, status: "success", title: "", content: "" }; // Clear form on success
    case "SUBMIT_ERROR":
      return { ...model, status: "error", error: action.payload };
    case "RESET_STATUS":
      return { ...model, status: "idle", error: null };
    default:
      return model;
  }
};

// --- Web Component Implementation ---

import tailwindStyles from "../styles/main.css?inline";

const sheet = new CSSStyleSheet();
sheet.replaceSync(tailwindStyles);

@customElement("my-note-form")
export class MyNoteForm extends LitElement {
  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot!.adoptedStyleSheets = [sheet];
  }

  @state()
  private _model: Model = {
    status: "idle",
    error: null,
    userId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    title: "",
    content: "",
  };

  // 4. Propose: The central function to dispatch actions and trigger updates.
  private propose(action: Action) {
    // a. Calculate the next state synchronously.
    this._model = update(this._model, action);
    // b. Handle any side effects based on the new state and action.
    this.react(this._model, action);
  }

  // 5. React: The "effect handler". This is where side effects like API calls live.
  private async react(model: Model, action: Action) {
    // Only react to the SUBMIT_START action to perform the API call.
    if (action.type === "SUBMIT_START") {
      const { userId, title, content } = model;
      const noteData = { user_id: userId, title, content };

      const createNoteApiCall = Effect.tryPromise({
        try: () => trpc.note.createNote.mutate(noteData),
        catch: (error: any) =>
          new Error(`tRPC Mutation Error: ${error.message}`),
      });

      const program = pipe(
        clientLog(
          "info",
          `User submitting note: "${title}"`,
          userId,
          "NoteSubmission",
        ),
        Effect.andThen(() => createNoteApiCall),
        Effect.tap((response) => {
          // On success, propose the SUBMIT_SUCCESS action.
          this.propose({ type: "SUBMIT_SUCCESS" });
          setTimeout(() => {
            if (this._model.status === "success")
              this.propose({ type: "RESET_STATUS" });
          }, 3000);
          return clientLog(
            "info",
            `Note created. ID: ${response?.id}`,
            userId,
            "NoteSubmission",
          );
        }),
        Effect.catchAll((error) => {
          const errorMessage = error.message || "An unknown error occurred.";
          // On failure, propose the SUBMIT_ERROR action.
          this.propose({ type: "SUBMIT_ERROR", payload: errorMessage });
          setTimeout(() => {
            if (this._model.status === "error")
              this.propose({ type: "RESET_STATUS" });
          }, 3000);
          return clientLog(
            "error",
            `Note creation failed: ${errorMessage}`,
            userId,
            "NoteSubmission",
          );
        }),
      );
      await Effect.runPromise(program);
    }
  }

  render() {
    return html`
      <div class="max-w-2xl mx-auto mt-6">
        <div class="bg-white border border-zinc-200 rounded-lg p-8">
          <h2 class="text-2xl font-bold text-zinc-900 mb-4">
            Create a New Note
          </h2>
          <div class="flex flex-col gap-4">
            <input
              name="title"
              placeholder="Note Title"
              required
              .value=${this._model.title}
              @input=${(e: Event) =>
                this.propose({
                  type: "UPDATE_TITLE",
                  payload: (e.target as HTMLInputElement).value,
                })}
              .disabled=${this._model.status === "submitting"}
              class="w-full px-3 py-2 border border-zinc-300 rounded-md"
            />
            <textarea
              name="content"
              placeholder="Your thoughts go here..."
              required
              .value=${this._model.content}
              @input=${(e: Event) =>
                this.propose({
                  type: "UPDATE_CONTENT",
                  payload: (e.target as HTMLTextAreaElement).value,
                })}
              .disabled=${this._model.status === "submitting"}
              class="w-full px-3 py-2 border border-zinc-300 rounded-md min-h-[120px]"
            ></textarea>

            <notion-button
              class="self-end"
              .loading=${this._model.status === "submitting"}
              @notion-button-click=${() => {
                if (!this._model.title) {
                  this.propose({
                    type: "SUBMIT_ERROR",
                    payload: "Title is required.",
                  });
                } else {
                  this.propose({ type: "SUBMIT_START" });
                }
              }}
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
          </div>
        </div>
      </div>
    `;
  }
}
