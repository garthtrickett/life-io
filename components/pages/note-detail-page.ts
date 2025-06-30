// File: ./components/pages/note-detail-page.ts
import { html, type TemplateResult } from "lit-html";
import { signal, type Signal } from "@preact/signals-core";
import { pipe, Effect, Data } from "effect";
import { runClientPromise, runClientUnscoped } from "../../lib/client/runtime";
import type { NoteDto } from "../../types/generated/Note";
import styles from "./NoteDetailView.module.css";
import { trpc } from "../../lib/client/trpc";
import { clientLog } from "../../lib/client/logger.client";

// --- Custom Error Types (NEW) ---
class NoteFetchError extends Data.TaggedError("NoteFetchError")<{
  readonly cause: unknown;
}> {}
class NoteSaveError extends Data.TaggedError("NoteSaveError")<{
  readonly cause: unknown;
}> {}
class NoteValidationError extends Data.TaggedError("NoteValidationError")<{
  readonly message: string;
}> {}

// --- Types ---
interface ViewResult {
  template: TemplateResult;
  cleanup?: () => void;
}
interface Model {
  status: "loading" | "idle" | "saving" | "saved" | "error";
  note: NoteDto | null;
  error: string | null;
}

// --- UPDATED ACTION ---
type Action =
  | { type: "FETCH_START" }
  | { type: "FETCH_SUCCESS"; payload: NoteDto }
  | { type: "FETCH_ERROR"; payload: NoteFetchError } // Typed error
  | { type: "UPDATE_TITLE"; payload: string }
  | { type: "UPDATE_CONTENT"; payload: string }
  | { type: "SAVE_START" }
  | { type: "SAVE_SUCCESS"; payload: NoteDto }
  | { type: "SAVE_ERROR"; payload: NoteSaveError | NoteValidationError } // Typed error
  | { type: "RESET_SAVE_STATUS" };

interface NoteController {
  modelSignal: Signal<Model>;
  propose: (action: Action) => void;
  cleanup: () => void;
}
interface ControllerCacheEntry {
  controller: NoteController;
  cleanupTimeoutId?: number;
}
interface WindowWithNoteControllers extends Window {
  noteDetailControllers: Map<string, ControllerCacheEntry>;
}
declare const window: WindowWithNoteControllers;
if (!window.noteDetailControllers) {
  window.noteDetailControllers = new Map<string, ControllerCacheEntry>();
}
const controllers: Map<string, ControllerCacheEntry> =
  window.noteDetailControllers;

function createNoteController(id: string): NoteController {
  const modelSignal = signal<Model>({
    status: "loading",
    note: null,
    error: null,
  });

  let originalNoteContent = "";
  let updateTimeout: number | undefined;

  const update = (action: Action) => {
    const model = modelSignal.value;
    switch (action.type) {
      case "FETCH_START":
        modelSignal.value = { ...model, status: "loading", error: null };
        break;
      case "FETCH_SUCCESS":
        modelSignal.value = {
          status: "idle",
          note: action.payload,
          error: null,
        };
        originalNoteContent = JSON.stringify({
          title: action.payload.title,
          content: action.payload.content,
        });
        break;
      // --- REFACTORED: Set specific error message ---
      case "FETCH_ERROR": {
        modelSignal.value = {
          status: "error",
          error:
            "Could not load the note. It may have been deleted or you may not have permission to view it.",
          note: null,
        };
        break;
      }
      case "UPDATE_TITLE":
        if (model.note) {
          modelSignal.value = {
            ...model,
            status: "idle",
            note: { ...model.note, title: action.payload },
          };
        }
        break;
      case "UPDATE_CONTENT":
        if (model.note) {
          modelSignal.value = {
            ...model,
            status: "idle",
            note: { ...model.note, content: action.payload },
          };
        }
        break;
      case "SAVE_START":
        modelSignal.value = { ...model, status: "saving", error: null };
        break;
      case "SAVE_SUCCESS":
        modelSignal.value = {
          status: "saved",
          note: action.payload,
          error: null,
        };
        originalNoteContent = JSON.stringify({
          title: action.payload.title,
          content: action.payload.content,
        });
        break;
      // --- REFACTORED: Handle specific save errors ---
      case "SAVE_ERROR": {
        let message = "An unknown error occurred while saving.";
        if (action.payload._tag === "NoteValidationError") {
          message = action.payload.message;
        } else if (action.payload._tag === "NoteSaveError") {
          message = "A server error occurred. Please try again later.";
        }
        modelSignal.value = { ...model, status: "error", error: message };
        break;
      }
      case "RESET_SAVE_STATUS":
        modelSignal.value = { ...model, status: "idle" };
        break;
    }
  };

  const react = (action: Action) => {
    const model = modelSignal.value;
    switch (action.type) {
      case "FETCH_START": {
        const fetchEffect = Effect.tryPromise({
          try: () => trpc.note.getById.query({ id }),
          catch: (err) => new NoteFetchError({ cause: err }),
        });
        void runClientPromise(
          Effect.match(fetchEffect, {
            onSuccess: (note) =>
              propose({ type: "FETCH_SUCCESS", payload: note as NoteDto }),
            onFailure: (err) => propose({ type: "FETCH_ERROR", payload: err }),
          }),
        );
        break;
      }
      case "UPDATE_TITLE":
      case "UPDATE_CONTENT":
        clearTimeout(updateTimeout);
        updateTimeout = window.setTimeout(
          () => propose({ type: "SAVE_START" }),
          500,
        );
        break;
      case "SAVE_START": {
        if (!model.note) return;
        if (!model.note.title.trim()) {
          propose({
            type: "SAVE_ERROR",
            payload: new NoteValidationError({
              message: "Title cannot be empty.",
            }),
          });
          return;
        }
        const currentNoteContent = JSON.stringify({
          title: model.note.title,
          content: model.note.content,
        });
        if (currentNoteContent === originalNoteContent) {
          propose({ type: "RESET_SAVE_STATUS" });
          return;
        }
        const { title, content } = model.note;
        const saveEffect = pipe(
          Effect.tryPromise({
            try: () => trpc.note.update.mutate({ id, title, content }),
            catch: (err) => new NoteSaveError({ cause: err }),
          }),
          Effect.flatMap((note) =>
            note
              ? Effect.succeed(note)
              : Effect.fail(
                  new NoteSaveError({
                    cause: "Server did not return updated note.",
                  }),
                ),
          ),
        );
        void runClientPromise(
          Effect.match(saveEffect, {
            onSuccess: (note) =>
              propose({ type: "SAVE_SUCCESS", payload: note as NoteDto }),
            onFailure: (err) => propose({ type: "SAVE_ERROR", payload: err }),
          }),
        );
        break;
      }
      case "SAVE_SUCCESS":
        setTimeout(() => propose({ type: "RESET_SAVE_STATUS" }), 2000);
        break;
    }
  };

  const propose = (action: Action) => {
    runClientUnscoped(
      clientLog(
        "debug",
        `NoteDetailView(${id}): Proposing action ${action.type}`,
        undefined,
        `NoteDetail:propose`,
      ),
    );
    update(action);
    void react(action);
  };

  propose({ type: "FETCH_START" });

  return {
    modelSignal,
    propose,
    cleanup: () => {
      clearTimeout(updateTimeout);
      const entry = controllers.get(id);
      if (entry) {
        entry.cleanupTimeoutId = window.setTimeout(() => {
          controllers.delete(id);
        }, 30000);
      }
    },
  };
}

function getNoteController(id: string): NoteController {
  let entry = controllers.get(id);
  if (entry?.cleanupTimeoutId) {
    clearTimeout(entry.cleanupTimeoutId);
    delete entry.cleanupTimeoutId;
  }
  if (!entry) {
    const controller = createNoteController(id);
    entry = { controller };
    controllers.set(id, entry);
  }
  return entry.controller;
}

export const NoteDetailView = (id: string): ViewResult => {
  const controller = getNoteController(id);
  const model = controller.modelSignal.value;

  const renderStatus = () => {
    switch (model.status) {
      case "saving":
        return html`Saving...`;
      case "saved":
        return html`<span class="text-green-600">Saved</span>`;
      case "error":
        return html`<span class="text-red-600">${model.error}</span>`;
      default:
        return html``;
    }
  };

  return {
    template: html`
      <div class=${styles.container}>
        ${model.status === "loading"
          ? html`<p class="p-8 text-center text-zinc-500">Loading note...</p>`
          : model.note
            ? html`
                <div class=${styles.editor}>
                  <div class=${styles.header}>
                    <h2>Edit Note</h2>
                    <div class=${styles.status}>${renderStatus()}</div>
                  </div>
                  <input
                    type="text"
                    .value=${model.note.title}
                    @input=${(e: Event) =>
                      controller.propose({
                        type: "UPDATE_TITLE",
                        payload: (e.target as HTMLInputElement).value,
                      })}
                    class=${styles.titleInput}
                    ?disabled=${model.status === "saving"}
                  />
                  <textarea
                    .value=${model.note.content}
                    @input=${(e: Event) =>
                      controller.propose({
                        type: "UPDATE_CONTENT",
                        payload: (e.target as HTMLTextAreaElement).value,
                      })}
                    class=${styles.contentInput}
                    ?disabled=${model.status === "saving"}
                  ></textarea>
                </div>
              `
            : html`
                <div class=${styles.errorText}>
                  ${model.error || "Note could not be loaded."}
                </div>
              `}
      </div>
    `,
    cleanup: controller.cleanup,
  };
};
