// File: ./components/pages/notes-list-page.ts
// --- UPDATE: Applied the styling approach from note-detail-page.ts ---
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Effect, pipe } from "effect";
import { animate as animateDirective } from "@lit-labs/motion";
import {
  animate,
  stagger,
  type DOMKeyframesDefinition,
  type AnimationOptions,
} from "motion";
import { PageAnimationMixin } from "../mixins/page-animation-mixin.ts";
import { trpc } from "../../lib/client/trpc";
import { clientLog } from "../../lib/client/logger.client";
import type { NoteDto } from "../../types/generated/Note";
import { navigate } from "../../lib/client/router.ts";
import tailwindStyles from "../../styles/main.css?inline";
import "../ui/notion-button-a11y.ts";
import "../ui/skeleton-loader.ts";

// --- STYLING: Create and populate a stylesheet to be adopted by the component ---
const sheet = new CSSStyleSheet();
sheet.replaceSync(tailwindStyles);

// --- SAM (State-Action-Model) Pattern Definition ---
interface Model {
  notes: NoteDto[];
  isLoading: boolean;
  isCreating: boolean;
  error: string | null;
  userId: string;
}

type Action =
  | { type: "FETCH_NOTES_START" }
  | { type: "FETCH_NOTES_SUCCESS"; payload: NoteDto[] }
  | { type: "FETCH_NOTES_ERROR"; payload: string }
  | { type: "CREATE_NOTE_START" }
  | { type: "CREATE_NOTE_SUCCESS"; payload: NoteDto }
  | { type: "CREATE_NOTE_ERROR"; payload: string }
  | { type: "SORT_NOTES_AZ" };

const update = (model: Model, action: Action): Model => {
  switch (action.type) {
    case "FETCH_NOTES_START":
      return { ...model, isLoading: true, error: null };
    case "FETCH_NOTES_SUCCESS":
      return { ...model, isLoading: false, notes: action.payload };
    case "FETCH_NOTES_ERROR":
      return { ...model, isLoading: false, error: action.payload };
    case "CREATE_NOTE_START":
      return { ...model, isCreating: true, error: null };
    // --- UPDATE: The model now correctly stores the new note in its list ---
    case "CREATE_NOTE_SUCCESS":
      // Add the new note to the start of the notes array to keep the model's state consistent.
      // This ensures the model accurately reflects the data state without needing a full refetch.
      return {
        ...model,
        isCreating: false,
        notes: [action.payload, ...model.notes],
      };
    case "CREATE_NOTE_ERROR":
      return { ...model, isCreating: false, error: action.payload };
    case "SORT_NOTES_AZ": {
      // FIX: Add block scope to prevent no-case-declarations error
      const sortedNotes = [...model.notes].sort((a, b) =>
        a.title.localeCompare(b.title),
      );
      return { ...model, notes: sortedNotes };
    }
    default:
      return model;
  }
};

@customElement("dashboard-page")
export class DashboardPage extends PageAnimationMixin(LitElement) {
  @state()
  private _model: Model = {
    notes: [],
    isLoading: true,
    isCreating: false,
    error: null,
    userId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  };

  connectedCallback() {
    super.connectedCallback();
    // --- STYLING: Apply the stylesheet to the component's shadow DOM ---
    this.shadowRoot!.adoptedStyleSheets = [sheet];
    this.propose({ type: "FETCH_NOTES_START" });
  }

  private propose(action: Action) {
    this._model = update(this._model, action);
    this.requestUpdate();
    // FIX: Use `void` to explicitly ignore the returned promise, resolving the no-floating-promises error.
    void this.react(this._model, action);
  }

  private async react(model: Model, action: Action) {
    switch (action.type) {
      case "FETCH_NOTES_START": {
        // FIX: Add block scope to prevent no-case-declarations error
        const fetchEffect = pipe(
          Effect.tryPromise({
            try: () => trpc.note.list.query(),
            catch: (e) => new Error(String(e)),
          }),
          Effect.match({
            onSuccess: (notes) =>
              this.propose({
                type: "FETCH_NOTES_SUCCESS",
                payload: notes as NoteDto[],
              }),
            onFailure: (e) =>
              this.propose({
                type: "FETCH_NOTES_ERROR",
                payload: `Failed to fetch notes: ${e.message}`,
              }),
          }),
        );
        await Effect.runPromise(fetchEffect);
        break;
      }
      case "FETCH_NOTES_SUCCESS": {
        // FIX: Add block scope to prevent no-case-declarations error
        await this.updateComplete;
        // --- STYLING: Query inside the shadowRoot for animation targets ---
        const listItems = Array.from(
          this.shadowRoot!.querySelectorAll<HTMLElement>("ul li"),
        );
        if (listItems.length > 0) {
          const keyframes: DOMKeyframesDefinition = {
            opacity: [0, 1],
            transform: ["translateY(20px)", "translateY(0)"],
          };
          const options: AnimationOptions = {
            delay: stagger(0.07),
            duration: 0.5,
          };
          animate(listItems, keyframes, options);
        }
        break;
      }
      case "CREATE_NOTE_START": {
        // FIX: Add block scope to prevent no-case-declarations error
        const createEffect = pipe(
          Effect.tryPromise({
            try: () =>
              trpc.note.create.mutate({ title: "Untitled Note", content: "" }),
            catch: (e) => new Error(String(e)),
          }),
          Effect.flatMap((newNote) =>
            newNote?.id
              ? Effect.succeed(newNote)
              : Effect.fail(new Error("No ID returned from server.")),
          ),
          Effect.tap((newNote) =>
            clientLog(
              "info",
              `Note created. ID: ${newNote.id}`,
              model.userId,
              "Dashboard",
            ),
          ),
          Effect.match({
            onSuccess: (newNote) =>
              this.propose({
                type: "CREATE_NOTE_SUCCESS",
                payload: newNote as NoteDto,
              }),
            onFailure: (e) =>
              this.propose({
                type: "CREATE_NOTE_ERROR",
                payload: `Failed to create note: ${e.message}`,
              }),
          }),
        );
        await Effect.runPromise(createEffect);
        break;
      }
      case "CREATE_NOTE_SUCCESS":
        navigate(`/notes/${action.payload.id}`);
        break;
    }
  }

  renderNotesList() {
    if (this._model.isLoading) {
      return html`
        <div class="space-y-3">
          <skeleton-loader class="h-12 w-full rounded-md"></skeleton-loader>
          <skeleton-loader class="h-12 w-full rounded-md"></skeleton-loader>
          <skeleton-loader class="h-12 w-2/3 rounded-md"></skeleton-loader>
        </div>
      `;
    }

    if (this._model.notes.length === 0) {
      return html`
        <div class="py-16 text-center text-zinc-500">
          <h3 class="text-xl font-semibold">No notes yet</h3>
          <p class="mt-2">Click "Create New Note" to get started.</p>
        </div>
      `;
    }

    return html`
      <ul class="space-y-3">
        ${this._model.notes.map(
          (note) => html`
            <li .key=${note.id} ${animateDirective({ skipInitial: true })}>
              <a
                href="/notes/${note.id}"
                class="block rounded-lg border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-400"
                @click=${(e: Event) => {
                  e.preventDefault();
                  navigate(`/notes/${note.id}`);
                }}
              >
                <h3 class="font-semibold text-zinc-800">${note.title}</h3>
                <p class="mt-1 line-clamp-2 text-sm text-zinc-500">
                  ${note.content || "No additional content"}
                </p>
              </a>
            </li>
          `,
        )}
      </ul>
    `;
  }

  render() {
    if (this._model.isCreating) {
      return html`
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-gray-50"
        >
          <div
            class="h-12 w-12 animate-spin rounded-full border-4 border-zinc-300 border-t-zinc-600"
          ></div>
        </div>
      `;
    }

    return html`
      <div class="mx-auto mt-6 max-w-3xl p-4 md:p-0">
        <div
          class="mb-6 flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-6"
        >
          <div>
            <h2 class="text-2xl font-bold text-zinc-900">Your Notes</h2>
            <p class="mt-1 text-zinc-600">
              Create, view, and edit your notes below.
            </p>
          </div>
          <div class="flex items-center gap-2">
            <button
              @click=${() => this.propose({ type: "SORT_NOTES_AZ" })}
              class="rounded-md bg-zinc-100 px-3 py-2 text-sm font-semibold text-zinc-600 transition-colors hover:bg-zinc-200"
            >
              Sort A-Z
            </button>
            <notion-button
              @notion-button-click=${() =>
                this.propose({ type: "CREATE_NOTE_START" })}
              .loading=${this._model.isCreating}
            >
              Create New Note
            </notion-button>
          </div>
        </div>

        ${this._model.error
          ? html`
              <div class="mb-4 text-red-500">${this._model.error}</div>
            `
          : ""}
        ${this.renderNotesList()}
      </div>
    `;
  }
}
