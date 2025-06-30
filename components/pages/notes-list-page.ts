// File: components/pages/notes-list-page.ts
import { html, type TemplateResult, nothing } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import { signal } from "@preact/signals-core";
import { pipe, Effect } from "effect";
import { trpc } from "../../lib/client/trpc";
import { runClientEffect } from "../../lib/client/runtime";
import type { NoteDto } from "../../types/generated/Note";
import styles from "./NotesView.module.css";
import { navigate } from "../../lib/client/router";
import { clientLog } from "../../lib/client/logger.client";
import { NotionButton } from "../ui/notion-button";
import "../ui/skeleton-loader.ts";

// --- Types ---
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

// --- Module-level state and logic ---
const model = signal<Model>({
  notes: [],
  isLoading: true,
  isCreating: false,
  error: null,
});

const hasAnimatedIn = signal(false);

const update = (action: Action): void => {
  switch (action.type) {
    case "FETCH_NOTES_START":
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
      model.value = { ...model.value, isLoading: false, error: action.payload };
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

const react = (action: Action) => {
  switch (action.type) {
    case "FETCH_NOTES_START": {
      pipe(
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
        runClientEffect,
      );
      break;
    }
    case "FETCH_NOTES_SUCCESS": {
      if (!hasAnimatedIn.value) {
        requestAnimationFrame(() => {
          const notesList = document.querySelector("#notes-list");
          if (notesList && notesList.children.length > 0) {
            hasAnimatedIn.value = true;
          }
        });
      }
      break;
    }
    case "CREATE_NOTE_START": {
      pipe(
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
        runClientEffect,
      );
      break;
    }
    case "CREATE_NOTE_SUCCESS":
      runClientEffect(
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
  update(action);
  react(action);
};

export const NotesView = (): ViewResult => {
  if (model.value.isLoading && model.value.notes.length === 0) {
    propose({ type: "FETCH_NOTES_START" });
  }

  const renderNotes = () => {
    if (model.value.isLoading) {
      return html`
        <div class="space-y-3">
          <skeleton-loader class="h-12 w-full"></skeleton-loader>
          <skeleton-loader class="h-12 w-full"></skeleton-loader>
          <skeleton-loader class="h-12 w-2/3"></skeleton-loader>
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
      <ul id="notes-list" class=${styles.notesList}>
        ${repeat(
          model.value.notes,
          (note) => note.id,
          (note) => html`
            <li style="visibility: hidden">
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

  return {
    template: html`
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
            ${NotionButton({
              children: model.value.isCreating
                ? "Creating..."
                : "Create New Note",
              loading: model.value.isCreating,
              onClick: () => propose({ type: "CREATE_NOTE_START" }),
            })}
          </div>
        </div>
        ${model.value.error
          ? html`<div class=${styles.errorText}>${model.value.error}</div>`
          : nothing}
        ${renderNotes()}
      </div>
    `,
    cleanup: () => {
      hasAnimatedIn.value = false;
    },
  };
};
