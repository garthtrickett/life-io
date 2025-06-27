// File: ./components/my-note-form.ts

import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Effect, pipe } from "effect";
import { clientLog } from "../lib/client/logger.client.js";
import { trpc } from "../lib/client/trpc.js";

type Status = "idle" | "submitting" | "success" | "error";

@customElement("my-note-form")
export class MyNoteForm extends LitElement {
  static styles = css`
    .container {
      padding: 2rem;
      max-width: 42rem;
      margin: auto;
    }
    .form-card {
      border: 1px solid #e5e7eb;
      padding: 1.5rem;
      border-radius: 0.5rem;
      background-color: #ffffff;
      color: #18181b;
    }
    h2 {
      font-size: 1.5rem;
      font-weight: 600;
      margin: 0 0 1rem 0;
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    input,
    textarea {
      width: 100%;
      padding: 0.5rem 0.75rem;
      border: 1px solid #d4d4d8;
      border-radius: 0.375rem;
      font-family: inherit;
      font-size: 1rem;
      box-sizing: border-box; /* Important for padding and border */
    }
    textarea {
      min-height: 120px;
      resize: vertical;
    }
    button {
      align-self: flex-end;
      padding: 0.5rem 1rem;
      background-color: #3f3f46;
      color: #fafafa;
      border: none;
      border-radius: 0.375rem;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 0.2s;
    }
    button:hover {
      background-color: #27272a;
    }
    button:disabled {
      background-color: #a1a1aa;
      cursor: not-allowed;
    }
    .status-message {
      margin-top: 1rem;
      padding: 0.75rem;
      border-radius: 0.375rem;
    }
    .error {
      background-color: #fee2e2;
      color: #b91c1c;
      border: 1px solid #fecaca;
    }
    .success {
      background-color: #dcfce7;
      color: #166534;
      border: 1px solid #bbf7d0;
    }
  `;

  @state()
  private _status: Status = "idle";

  @state()
  private _error: string | null = null;

  // For demo purposes, we'll use a hardcoded user ID.
  // In a real app, this would come from an authentication context.
  private _userId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

  // Disable shadow DOM to allow for potential global styling.
  createRenderRoot() {
    return this;
  }

  private async _handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    const title = (formData.get("title") as string) || "";
    const content = (formData.get("content") as string) || "";

    if (!title) {
      this._status = "error";
      this._error = "Title is required.";
      return;
    }

    this._status = "submitting";
    this._error = null;

    const noteData = { user_id: this._userId, title, content };

    const createNoteApiCall = Effect.tryPromise({
      try: () => trpc.note.createNote.mutate(noteData),
      catch: (error: any) => new Error(`tRPC Mutation Error: ${error.message}`),
    });

    const program = pipe(
      clientLog(
        "info",
        `User attempting to create note: "${title}"`,
        this._userId,
        "NoteCreation",
      ),
      Effect.andThen(() => createNoteApiCall),
      Effect.tap((response) => {
        // This block runs on success
        this._status = "success";
        form.reset(); // Clear the form on success

        // --- FIX: Move the status reset logic here ---
        setTimeout(() => {
          if (this._status === "success") {
            this._status = "idle";
          }
        }, 3000);

        // Log the successful creation
        return clientLog(
          "info",
          `Successfully created note via tRPC. Response ID: ${response?.id}`,
          this._userId,
          "NoteCreation",
        );
      }),
      Effect.catchAll((error) => {
        // This block runs on failure
        const errorMessage = error.message || "An unknown error occurred.";
        this._status = "error";
        this._error = errorMessage;

        // --- FIX: Move the status reset logic here ---
        setTimeout(() => {
          if (this._status === "error") {
            this._status = "idle";
          }
        }, 3000);

        // Log the error and then continue without crashing
        return pipe(
          clientLog(
            "error",
            `Failed to create note via tRPC: ${errorMessage}`,
            this._userId,
            "NoteCreation",
          ),
          Effect.andThen(() => Effect.void), // Discard the error and continue
        );
      }),
    );

    // Run the entire Effect program
    await Effect.runPromise(program);

    // --- REMOVED: The problematic if-block is no longer needed here ---
  }

  render() {
    return html`
      <div class="container">
        <div class="form-card">
          <h2>Create a New Note</h2>
          <form @submit=${this._handleSubmit}>
            <input
              name="title"
              placeholder="Note Title"
              required
              .disabled=${this._status === "submitting"}
            />
            <textarea
              name="content"
              placeholder="Your thoughts go here..."
              required
              .disabled=${this._status === "submitting"}
            ></textarea>

            <button type="submit" .disabled=${this._status === "submitting"}>
              ${this._status === "submitting" ? "Creating..." : "Create Note"}
            </button>

            ${this._status === "error"
              ? html`<div class="status-message error">
                  Error: ${this._error}
                </div>`
              : ""}
            ${this._status === "success"
              ? html`<div class="status-message success">
                  Note created successfully!
                </div>`
              : ""}
          </form>
        </div>
      </div>
    `;
  }
}
