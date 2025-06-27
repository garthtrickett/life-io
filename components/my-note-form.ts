import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Effect, pipe } from "effect";
import { clientLog } from "../lib/client/logger.client.js";
import { trpc } from "../lib/client/trpc.js";
import "./notion-button-a11y.ts";

type Status = "idle" | "submitting" | "success" | "error";

@customElement("my-note-form")
export class MyNoteForm extends LitElement {
  // Disable Shadow DOM to use global Tailwind styles
  createRenderRoot() {
    return this;
  }

  @state()
  private _status: Status = "idle";

  @state()
  private _error: string | null = null;

  private _userId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

  private async _handleSubmit(e?: Event) {
    e?.preventDefault?.();
    const form = this.querySelector("form") as HTMLFormElement;
    const formData = new FormData(form);
    const title = (formData.get("title") as string) ?? "";
    const content = (formData.get("content") as string) ?? "";

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
        this._status = "success";
        form.reset();
        setTimeout(() => {
          if (this._status === "success") this._status = "idle";
        }, 3000);
        return clientLog(
          "info",
          `Successfully created note via tRPC. Response ID: ${response?.id}`,
          this._userId,
          "NoteCreation",
        );
      }),
      Effect.catchAll((error) => {
        const errorMessage = error.message || "An unknown error occurred.";
        this._status = "error";
        this._error = errorMessage;
        setTimeout(() => {
          if (this._status === "error") this._status = "idle";
        }, 3000);
        return pipe(
          clientLog(
            "error",
            `Failed to create note via tRPC: ${errorMessage}`,
            this._userId,
            "NoteCreation",
          ),
          Effect.andThen(() => Effect.void),
        );
      }),
    );
    await Effect.runPromise(program);
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
              .disabled=${this._status === "submitting"}
              class="w-full px-3 py-2 border border-zinc-300 rounded-md"
            />
            <textarea
              name="content"
              placeholder="Your thoughts go here..."
              required
              .disabled=${this._status === "submitting"}
              class="w-full px-3 py-2 border border-zinc-300 rounded-md min-h-[120px]"
            ></textarea>

            <notion-button
              class="self-end"
              .loading=${this._status === "submitting"}
              @notion-button-click=${this._handleSubmit}
            >
              ${this._status === "submitting" ? "Creating…" : "Create Note"}
            </notion-button>

            ${this._status === "error"
              ? html`<div
                  class="mt-4 p-3 rounded-md bg-red-100 text-red-800 border border-red-200"
                >
                  Error: ${this._error}
                </div>`
              : ""}
            ${this._status === "success"
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
