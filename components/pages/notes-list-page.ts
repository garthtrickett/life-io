// File: ./components/pages/notes-list-page.ts
import { render, html, type TemplateResult } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import { signal, effect } from "@preact/signals-core";
import { pipe, Effect } from "effect";
import { runClientPromise, runClientUnscoped } from "../../lib/client/runtime";
import type { NoteDto } from "../../types/generated/Note";
import styles from "./NotesView.module.css";
import { navigate } from "../../lib/client/router";
import { clientLog } from "../../lib/client/logger.client";
import { trpc } from "../../lib/client/trpc";
import { animate, stagger } from "motion";

interface ViewResult {
  template: TemplateResult;
  cleanup?: () => void;
}
interface Model {
  notes: NoteDto[];
  isLoading: boolean;
  isCreating: boolean;
  error: string | null;
}
type Action =
  | { type: "FETCH_NOTES_START" }
  | { type: "FETCH_NOTES_SUCCESS"; payload: NoteDto[] }
  | { type: "FETCH_NOTES_ERROR"; payload: string }
  | { type: "CREATE_NOTE_START" }
  | { type: "CREATE_NOTE_SUCCESS"; payload: NoteDto }
  | { type: "CREATE_NOTE_ERROR"; payload: string }
  | { type: "SORT_NOTES_AZ" };

const model = signal<Model>({
  notes: [],
  isLoading: true,
  isCreating: false,
  error: null,
});

const update = (action: Action) => {
  switch (action.type) {
    case "FETCH_NOTES_START":
      if (model.value.isLoading && model.value.notes.length === 0) {
        return;
      }
      model.value = { ...model.value, isLoading: true, error: null };
      break;
    case "FETCH_NOTES_SUCCESS":
      model.value = {
        ...model.value,
        isLoading: false,
        notes: action.payload,
      };
      break;
    case "FETCH_NOTES_ERROR":
      model.value = {
        ...model.value,
        isLoading: false,
        error: action.payload,
      };
      break;
    case "CREATE_NOTE_START":
      model.value = { ...model.value, isCreating: true, error: null };
      break;
    case "CREATE_NOTE_SUCCESS":
      model.value = {
        ...model.value,
        isCreating: false,
        notes: [action.payload, ...model.value.notes],
      };
      break;
    case "CREATE_NOTE_ERROR":
      model.value = {
        ...model.value,
        isCreating: false,
        error: action.payload,
      };
      break;
    case "SORT_NOTES_AZ": {
      const sortedNotes = [...model.value.notes].sort((a, b) =>
        a.title.localeCompare(b.title),
      );
      model.value = { ...model.value, notes: sortedNotes };
      break;
    }
  }
};

const react = async (action: Action) => {
  switch (action.type) {
    case "FETCH_NOTES_START": {
      const fetchEffect = pipe(
        Effect.tryPromise(() => trpc.note.list.query()),
        Effect.match({
          onSuccess: (notes) =>
            propose({
              type: "FETCH_NOTES_SUCCESS",
              payload: notes as NoteDto[],
            }),
          onFailure: (e) =>
            propose({
              type: "FETCH_NOTES_ERROR",
              payload: `Failed to fetch notes: ${
                e instanceof Error ? e.message : String(e)
              }`,
            }),
        }),
      );
      void runClientPromise(fetchEffect);
      break;
    }
    case "FETCH_NOTES_SUCCESS": {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const noteElements = Array.from(
        document
          .querySelector("app-shell")
          ?.shadowRoot?.querySelectorAll("ul li") ?? [],
      );
      if (noteElements.length > 0) {
        animate(
          noteElements,
          { opacity: [0, 1], transform: ["translateY(20px)", "translateY(0)"] },
          { delay: stagger(0.07), duration: 0.5 },
        );
      }
      break;
    }
    case "CREATE_NOTE_START": {
      const createEffect = pipe(
        Effect.tryPromise(() =>
          trpc.note.create.mutate({ title: "Untitled Note", content: "" }),
        ),
        Effect.flatMap((note) =>
          note?.id
            ? Effect.succeed(note)
            : Effect.fail(new Error("Server did not return a note.")),
        ),
        Effect.match({
          onSuccess: (note) =>
            propose({
              type: "CREATE_NOTE_SUCCESS",
              payload: note as NoteDto,
            }),
          onFailure: (e) =>
            propose({ type: "CREATE_NOTE_ERROR", payload: e.message }),
        }),
      );
      void runClientPromise(createEffect);
      break;
    }
    case "CREATE_NOTE_SUCCESS":
      runClientUnscoped(
        clientLog(
          "info",
          `Note creation success. Navigating to /notes/${action.payload.id}`,
          undefined,
          "NotesView:react",
        ),
      );
      navigate(`/notes/${action.payload.id}`);
      break;
  }
};

const propose = (action: Action) => {
  runClientUnscoped(
    clientLog(
      "debug",
      `NotesView: Proposing action ${action.type}`,
      undefined,
      "NotesView:propose",
    ),
  );
  update(action);
  void react(action);
};

export const NotesView = (): ViewResult => {
  const container = document.createElement("div");

  // Initial data fetch
  if (model.value.isLoading && model.value.notes.length === 0) {
    propose({ type: "FETCH_NOTES_START" });
  }

  const renderEffect = effect(() => {
    const renderNotes = () => {
      if (model.value.isLoading) {
        return html`
          <div class=${styles.skeletonContainer}>
            ${repeat(
              [1, 2, 3],
              (item) => item,
              () => html`<div class=${styles.skeletonItem}></div>`,
            )}
          </div>
        `;
      }
      if (model.value.notes.length === 0) {
        return html`
          <div class=${styles.emptyState}>
            <h3>No notes yet</h3>
            <p>Click "Create New Note" to get started.</p>
          </div>
        `;
      }
      return html`
        <ul class=${styles.notesList}>
          ${repeat(
            model.value.notes,
            (note) => note.id,
            (note) => html`
              <li>
                <a
                  href="/notes/${note.id}"
                  class=${styles.noteItem}
                  @click=${(e: Event) => {
                    e.preventDefault();
                    navigate(`/notes/${note.id}`);
                  }}
                >
                  <h3>${note.title}</h3>
                  <p>${note.content || "No additional content"}</p>
                </a>
              </li>
            `,
          )}
        </ul>
      `;
    };

    const template = html`
      <div class=${styles.container}>
        <div class=${styles.header}>
          <div>
            <h2>Your Notes</h2>
            <p>Create, view, and edit your notes below.</p>
          </div>
          <div class=${styles.actions}>
            <button
              @click=${() => propose({ type: "SORT_NOTES_AZ" })}
              class=${styles.sortButton}
            >
              Sort A-Z
            </button>
            <button
              @click=${() => propose({ type: "CREATE_NOTE_START" })}
              ?disabled=${model.value.isCreating}
              class=${styles.createButton}
            >
              ${model.value.isCreating ? "Creating..." : "Create New Note"}
            </button>
          </div>
        </div>
        ${model.value.error
          ? html`<div class=${styles.errorText}>${model.value.error}</div>`
          : ""}
        ${renderNotes()}
      </div>
    `;
    render(template, container);
  });

  return {
    template: html`${container}`,
    cleanup: () => {
      renderEffect();
      runClientUnscoped(
        clientLog(
          "debug",
          "NotesView cleanup running, resetting state.",
          undefined,
          "NotesView:cleanup",
        ),
      );
      model.value = {
        notes: [],
        isLoading: true,
        isCreating: false,
        error: null,
      };
    },
  };
};
