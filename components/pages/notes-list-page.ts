// File: ./components/pages/notes-list-page.ts
import { render, html, type TemplateResult } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import { pipe, Effect, Queue, Ref, Fiber } from "effect";
import { runClientUnscoped } from "../../lib/client/runtime";
import type { NoteDto } from "../../types/generated/Note";
import styles from "./NotesView.module.css";
import { navigate } from "../../lib/client/router";
import { clientLog } from "../../lib/client/logger.client";
import { trpc } from "../../lib/client/trpc";
import { animate, stagger } from "motion";

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

// --- View ---

export const NotesView = (): ViewResult => {
  const container = document.createElement("div");

  const componentProgram = Effect.gen(function* () {
    // --- State and Action Queue ---
    const model = yield* Ref.make<Model>({
      notes: [],
      isLoading: true,
      isCreating: false,
      error: null,
    });
    const actionQueue = yield* Queue.unbounded<Action>();

    // --- Propose Action ---
    const propose = (action: Action) =>
      Effect.runFork(
        pipe(
          clientLog(
            "debug",
            `NotesView: Proposing action ${action.type}`,
            undefined,
            "NotesView:propose",
          ),
          Effect.andThen(Queue.offer(actionQueue, action)),
        ),
      );

    // --- Pure Render Function ---
    const renderView = (currentModel: Model) => {
      const renderNotes = () => {
        if (currentModel.isLoading) {
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
        if (currentModel.notes.length === 0) {
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
              currentModel.notes,
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
                ?disabled=${currentModel.isCreating}
                class=${styles.createButton}
              >
                ${currentModel.isCreating ? "Creating..." : "Create New Note"}
              </button>
            </div>
          </div>
          ${currentModel.error
            ? html`<div class=${styles.errorText}>${currentModel.error}</div>`
            : ""}
          ${renderNotes()}
        </div>
      `;
      render(template, container);
    };

    // --- Action Handler (Update + React) ---
    const handleAction = (action: Action): Effect.Effect<void> =>
      Effect.gen(function* () {
        const currentModel = yield* Ref.get(model);

        switch (action.type) {
          case "FETCH_NOTES_START": {
            yield* Ref.set(model, {
              ...currentModel,
              isLoading: true,
              error: null,
            });
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
            yield* Effect.fork(fetchEffect);
            break;
          }
          case "FETCH_NOTES_SUCCESS": {
            yield* Ref.set(model, {
              ...currentModel,
              isLoading: false,
              notes: action.payload,
            });
            // Animate after the next render
            yield* Effect.promise(
              () => new Promise((resolve) => requestAnimationFrame(resolve)),
            );
            const noteElements = Array.from(
              container.querySelectorAll("ul li"),
            );
            if (noteElements.length > 0) {
              animate(
                noteElements,
                {
                  opacity: [0, 1],
                  transform: ["translateY(20px)", "translateY(0)"],
                },
                { delay: stagger(0.07), duration: 0.5 },
              );
            }
            break;
          }
          case "FETCH_NOTES_ERROR":
            yield* Ref.set(model, {
              ...currentModel,
              isLoading: false,
              error: action.payload,
            });
            break;

          case "CREATE_NOTE_START": {
            yield* Ref.set(model, {
              ...currentModel,
              isCreating: true,
              error: null,
            });
            const createEffect = pipe(
              Effect.tryPromise(() =>
                trpc.note.create.mutate({
                  title: "Untitled Note",
                  content: "",
                }),
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
            yield* Effect.fork(createEffect);
            break;
          }
          case "CREATE_NOTE_SUCCESS":
            yield* Ref.set(model, {
              ...currentModel,
              isCreating: false,
              notes: [action.payload, ...currentModel.notes],
            });
            yield* clientLog(
              "info",
              `Note created. Navigating to /notes/${action.payload.id}`,
              undefined,
              "NotesView:handleAction",
            );
            navigate(`/notes/${action.payload.id}`);
            break;
          case "CREATE_NOTE_ERROR":
            yield* Ref.set(model, {
              ...currentModel,
              isCreating: false,
              error: action.payload,
            });
            break;

          case "SORT_NOTES_AZ": {
            const sortedNotes = [...currentModel.notes].sort((a, b) =>
              a.title.localeCompare(b.title),
            );
            yield* Ref.set(model, { ...currentModel, notes: sortedNotes });
            break;
          }
        }
      });

    // --- Render Effect ---
    const renderEffect = Ref.get(model).pipe(
      Effect.tap(renderView),
      Effect.tap((m) =>
        clientLog(
          "debug",
          `Rendering NotesView with state: ${JSON.stringify(m)}`,
          undefined,
          "NotesView:render",
        ),
      ),
    );

    // --- Main Loop ---
    propose({ type: "FETCH_NOTES_START" }); // Initial action
    yield* Queue.take(actionQueue).pipe(
      Effect.flatMap(handleAction),
      Effect.andThen(renderEffect),
      Effect.forever,
    );
  });

  // --- Fork Lifecycle ---
  const fiber = runClientUnscoped(componentProgram);

  return {
    template: html`${container}`,
    cleanup: () => {
      runClientUnscoped(
        clientLog(
          "debug",
          "NotesView cleanup running, interrupting fiber.",
          undefined,
          "NotesView:cleanup",
        ),
      );
      runClientUnscoped(Fiber.interrupt(fiber));
    },
  };
};
