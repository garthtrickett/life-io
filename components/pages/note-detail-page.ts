// File: components/pages/note-detail-page.ts
import { html, type TemplateResult } from "lit-html";
import { signal, type Signal } from "@preact/signals-core";
import { pipe, Effect, Exit, Cause } from "effect";
import { runClientEffect } from "../../lib/client/runtime";
import type { NoteDto } from "../../types/generated/Note";
import styles from "./NoteDetailView.module.css";
import { trpc } from "../../lib/client/trpc";
import { clientLog } from "../../lib/client/logger.client";

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

// --- Controller Definition ---
interface NoteController {
  modelSignal: Signal<Model>;
  propose: (action: Action) => void;
  cleanup: () => void;
}

// --- Controller Cache & Lifecycle Management ---

/**
 * The cache entry for a controller, including a mechanism
 * to handle deferred cleanup.
 */
interface ControllerCacheEntry {
  controller: NoteController;
  cleanupTimeoutId?: number;
}

// Attach cache to the global window object to survive HMR reloads in dev.
if (!(window as any).noteDetailControllers) {
  (window as any).noteDetailControllers = new Map<
    string,
    ControllerCacheEntry
  >();
}
const controllers: Map<string, ControllerCacheEntry> = (window as any)
  .noteDetailControllers;

/**
 * Creates a controller for a given note ID. This function contains the
 * complete state management logic for a single note detail view.
 */
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
      case "FETCH_ERROR":
        modelSignal.value = {
          status: "error",
          error: action.payload,
          note: null,
        };
        break;
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
      case "SAVE_ERROR":
        modelSignal.value = {
          ...model,
          status: "error",
          error: action.payload,
        };
        break;
      case "RESET_SAVE_STATUS":
        modelSignal.value = { ...model, status: "idle" };
        break;
    }
  };

  const react = (action: Action) => {
    const model = modelSignal.value;
    switch (action.type) {
      case "FETCH_START": {
        const fetchEffect = pipe(
          Effect.tryPromise({
            try: () => trpc.note.getById.query({ id }),
            catch: (err) =>
              new Error(
                err instanceof Error
                  ? err.message
                  : "An unknown error occurred",
              ),
          }),
          Effect.flatMap((note) =>
            note
              ? Effect.succeed(note)
              : Effect.fail(new Error("Note not found or permission denied.")),
          ),
          Effect.match({
            onSuccess: (note) =>
              propose({ type: "FETCH_SUCCESS", payload: note as NoteDto }),
            onFailure: (err) =>
              propose({ type: "FETCH_ERROR", payload: err.message }),
          }),
        );
        runClientEffect(fetchEffect);
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
        if (!model.note || !model.note.title.trim()) {
          propose({ type: "SAVE_ERROR", payload: "Title cannot be empty." });
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
            catch: (err) =>
              new Error(
                err instanceof Error ? err.message : "Failed to save the note.",
              ),
          }),
          Effect.flatMap((note) =>
            note
              ? Effect.succeed(note)
              : Effect.fail(new Error("Server did not return updated note.")),
          ),
          Effect.match({
            onSuccess: (note) =>
              propose({ type: "SAVE_SUCCESS", payload: note as NoteDto }),
            onFailure: (err) =>
              propose({ type: "SAVE_ERROR", payload: err.message }),
          }),
        );
        runClientEffect(saveEffect);
        break;
      }
      case "SAVE_SUCCESS":
        setTimeout(() => propose({ type: "RESET_SAVE_STATUS" }), 2000);
        break;
    }
  };

  const propose = (action: Action) => {
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
        runClientEffect(
          clientLog(
            "debug",
            `Scheduling cleanup for controller: ${id}`,
            undefined,
            "NoteDetail:cleanup",
          ),
        );
        // Defer the deletion. If we re-render the same page, this will be cancelled.
        entry.cleanupTimeoutId = window.setTimeout(() => {
          controllers.delete(id);
          runClientEffect(
            clientLog(
              "info",
              `Controller for note ${id} has been garbage collected.`,
              undefined,
              "NoteDetail:cleanup",
            ),
          );
        }, 0);
      }
    },
  };
}

/**
 * Gets a controller from the cache or creates a new one. Crucially, it
 * cancels any pending cleanup for the requested controller, preventing the
 * infinite loop during re-renders.
 */
function getNoteController(id: string): NoteController {
  let entry = controllers.get(id);

  if (entry?.cleanupTimeoutId) {
    runClientEffect(
      clientLog(
        "debug",
        `Cancelling pending cleanup for controller: ${id}`,
        undefined,
        "NoteDetail:getNoteController",
      ),
    );
    clearTimeout(entry.cleanupTimeoutId);
    delete entry.cleanupTimeoutId;
  }

  if (!entry) {
    runClientEffect(
      clientLog(
        "info",
        `No controller found for id: ${id}. Creating a new one.`,
        undefined,
        "NoteDetail:getNoteController",
      ),
    );
    const controller = createNoteController(id);
    entry = { controller };
    controllers.set(id, entry);
  }

  return entry.controller;
}

/**
 * The main view function for the Note Detail page.
 */
export const NoteDetailView = (id: string): ViewResult => {
  const controller = getNoteController(id);
  const model = controller.modelSignal.value;

  const renderStatus = () => {
    switch (model.status) {
      case "saving":
        return html`
          Saving...
        `;
      case "saved":
        return html`
          <span class="text-green-600">Saved</span>
        `;
      case "error":
        return html`
          <span class="text-red-600">${model.error}</span>
        `;
      default:
        return html``;
    }
  };

  return {
    template: html`
      <div class=${styles.container}>
        ${model.status === "loading"
          ? html`
              <p class="p-8 text-center text-zinc-500">Loading note...</p>
            `
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
