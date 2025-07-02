// File: ./components/pages/note-detail-page.ts
import { render, html, type TemplateResult, nothing } from "lit-html";
import { pipe, Effect, Data, Queue, Ref, Fiber } from "effect";
import { runClientUnscoped } from "../../lib/client/runtime";
import type { Note } from "../../types/generated/public/Note";
import styles from "./NoteDetailView.module.css";
import { trpc } from "../../lib/client/trpc";
import { clientLog } from "../../lib/client/logger.client";
import { EditorView } from "../ui/editor-element";

// --- Custom Error Types ---
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
  note: Note | null;
  error: string | null;
  originalContent: string;
  saveFiber: Fiber.Fiber<void, void> | null;
  editorTemplate: TemplateResult | null;
}

// --- Action ---
type Action =
  | { type: "FETCH_START" }
  | { type: "FETCH_SUCCESS"; payload: Note }
  | { type: "FETCH_ERROR"; payload: NoteFetchError }
  | { type: "UPDATE_FIELD"; payload: { title?: string; content?: string } }
  | { type: "SAVE_START" }
  | { type: "SAVE_SUCCESS"; payload: Note }
  | { type: "SAVE_ERROR"; payload: NoteSaveError | NoteValidationError }
  | { type: "RESET_SAVE_STATUS" };

export const NoteDetailView = (id: string): ViewResult => {
  const container = document.createElement("div");
  const componentProgram = Effect.gen(function* () {
    // --- State and Action Queue ---
    const model = yield* Ref.make<Model>({
      status: "loading",
      note: null,
      error: null,
      originalContent: "",
      saveFiber: null,
      editorTemplate: null,
    });
    const actionQueue = yield* Queue.unbounded<Action>();

    // --- Propose Action ---
    const propose = (action: Action) =>
      pipe(
        clientLog(
          "debug",
          `NoteDetailView(${id}): Proposing action ${action.type}`,
          undefined,
          `NoteDetail:propose`,
        ),
        Effect.andThen(() => Queue.offer(actionQueue, action)),
        Effect.asVoid,
      );

    // --- Pure Render Function ---
    const renderView = (currentModel: Model) => {
      const handleEditorUpdate = (e: CustomEvent<{ content: string }>) => {
        runClientUnscoped(
          propose({
            type: "UPDATE_FIELD",
            payload: { content: e.detail.content },
          }),
        );
      };

      const renderStatus = () => {
        switch (currentModel.status) {
          case "saving":
            return html`Saving...`;
          case "saved":
            return html`<span class="text-green-600">Saved</span>`;
          case "error":
            return html`<span class="text-red-600"
              >${currentModel.error}</span
            >`;
          default:
            return html``;
        }
      };

      const template = html`
        <div class=${styles.container}>
          ${currentModel.status === "loading"
            ? html`<p class="p-8 text-center text-zinc-500">Loading note...</p>`
            : currentModel.note
              ? html`
                  <div class=${styles.editor}>
                    <div class=${styles.header}>
                      <h2>Edit Note</h2>
                      <div class=${styles.status}>${renderStatus()}</div>
                    </div>
                    <input
                      type="text"
                      .value=${currentModel.note.title}
                      @input=${(e: Event) =>
                        runClientUnscoped(
                          propose({
                            type: "UPDATE_FIELD",
                            payload: {
                              title: (e.target as HTMLInputElement).value,
                            },
                          }),
                        )}
                      class=${styles.titleInput}
                      ?disabled=${currentModel.status === "saving"}
                    />
                    <div @editor-update=${handleEditorUpdate}>
                      ${currentModel.editorTemplate || nothing}
                    </div>
                  </div>
                `
              : html`
                  <div class=${styles.errorText}>
                    ${currentModel.error || "Note could not be loaded."}
                  </div>
                `}
        </div>
      `;
      render(template, container);
    };

    // --- Action Handler ---
    const handleAction = (action: Action): Effect.Effect<void> =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* clientLog(
            "debug",
            `[handleAction] Processing action: ${action.type}`,
          );

          const currentModel = yield* Ref.get(model);

          switch (action.type) {
            case "FETCH_START": {
              yield* Ref.update(
                model,
                (m): Model => ({
                  ...m,
                  status: "loading",
                  error: null,
                }),
              );
              const fetchEffect = pipe(
                Effect.tryPromise({
                  try: () => trpc.note.getById.query({ id }),
                  catch: (err) => new NoteFetchError({ cause: err }),
                }),
                Effect.matchEffect({
                  onSuccess: (note) =>
                    propose({
                      type: "FETCH_SUCCESS",
                      payload: note,
                    }),
                  onFailure: (err) =>
                    propose({ type: "FETCH_ERROR", payload: err }),
                }),
              );
              yield* Effect.fork(fetchEffect);
              break;
            }

            case "FETCH_SUCCESS": {
              const note = action.payload;
              const editorComponent = EditorView({
                initialContent: note.content,
              });
              if (editorComponent.cleanup) {
                yield* Effect.addFinalizer(() =>
                  Effect.sync(editorComponent.cleanup!),
                );
              }

              yield* Ref.update(
                model,
                (m): Model => ({
                  ...m,
                  status: "idle",
                  note,
                  error: null,
                  originalContent: JSON.stringify({
                    title: note.title,
                    content: note.content,
                  }),
                  editorTemplate: editorComponent.template,
                }),
              );
              break;
            }

            case "FETCH_ERROR": {
              yield* Ref.update(
                model,
                (m): Model => ({
                  ...m,
                  status: "error",
                  error:
                    "Could not load the note. It may have been deleted or you may not have permission to view it.",
                  note: null,
                }),
              );
              break;
            }

            case "UPDATE_FIELD": {
              if (currentModel.note) {
                const updatedNote = { ...currentModel.note, ...action.payload };
                yield* Ref.update(model, (m) => ({ ...m, note: updatedNote }));

                if (currentModel.saveFiber) {
                  yield* Fiber.interrupt(currentModel.saveFiber);
                }

                const saveFiber = yield* pipe(
                  Effect.sleep("500 millis"),
                  Effect.andThen(() => propose({ type: "SAVE_START" })),
                  Effect.fork,
                );
                yield* Ref.update(model, (m) => ({ ...m, saveFiber }));
              }
              break;
            }

            case "SAVE_START": {
              if (!currentModel.note) return;

              if (!currentModel.note.title.trim()) {
                yield* propose({
                  type: "SAVE_ERROR",
                  payload: new NoteValidationError({
                    message: "Title cannot be empty.",
                  }),
                });
                return;
              }

              const currentContent = JSON.stringify({
                title: currentModel.note.title,
                content: currentModel.note.content,
              });
              if (currentContent === currentModel.originalContent) {
                return;
              }

              yield* Ref.update(
                model,
                (m): Model => ({
                  ...m,
                  status: "saving",
                  error: null,
                }),
              );
              const { title, content } = currentModel.note;
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
                Effect.matchEffect({
                  onSuccess: (note) =>
                    propose({ type: "SAVE_SUCCESS", payload: note }),
                  onFailure: (err) =>
                    propose({ type: "SAVE_ERROR", payload: err }),
                }),
              );
              yield* Effect.fork(saveEffect);
              break;
            }

            case "SAVE_SUCCESS": {
              const note = action.payload;
              yield* Ref.update(
                model,
                (m): Model => ({
                  ...m,
                  status: "saved",
                  note,
                  originalContent: JSON.stringify({
                    title: note.title,
                    content: note.content,
                  }),
                }),
              );
              yield* pipe(
                Effect.sleep("2 seconds"),
                Effect.andThen(() => propose({ type: "RESET_SAVE_STATUS" })),
                Effect.fork,
              );
              break;
            }

            case "SAVE_ERROR": {
              let message = "An unknown error occurred while saving.";
              if (action.payload._tag === "NoteValidationError") {
                message = action.payload.message;
              } else if (action.payload._tag === "NoteSaveError") {
                message = "A server error occurred. Please try again later.";
              }
              yield* Ref.update(
                model,
                (m): Model => ({
                  ...m,
                  status: "error",
                  error: message,
                }),
              );
              break;
            }

            case "RESET_SAVE_STATUS": {
              if (currentModel.status === "saved") {
                yield* Ref.update(
                  model,
                  (m): Model => ({ ...m, status: "idle" }),
                );
              }
              break;
            }
          }
        }),
      );

    // --- Render Effect ---
    const renderEffect = Ref.get(model).pipe(
      Effect.tap(renderView),
      Effect.tap((m) => {
        // *** THIS IS THE FIX ***
        // Create a safe, serializable object for logging.
        // We avoid logging the complex `editorTemplate` and `saveFiber`.
        const loggableState = {
          status: m.status,
          noteId: m.note?.id,
          error: m.error,
        };
        return clientLog(
          "debug",
          `Rendering NoteDetailView with state: ${JSON.stringify(loggableState)}`,
          undefined,
          "NoteDetail:render",
        );
      }),
    );

    // --- Main Loop ---
    yield* propose({ type: "FETCH_START" });

    const mainLoop = Queue.take(actionQueue).pipe(
      Effect.flatMap(handleAction),
      Effect.andThen(renderEffect),
      Effect.catchAllDefect((defect) =>
        clientLog(
          "error",
          `[FATAL] Uncaught defect in main loop: ${String(defect)}`,
        ),
      ),
      Effect.forever,
    );

    yield* mainLoop;
  });

  // --- Fork Lifecycle ---
  const fiber = runClientUnscoped(componentProgram);
  return {
    template: html`${container}`,
    cleanup: () => {
      runClientUnscoped(
        clientLog(
          "debug",
          `NoteDetailView(${id}) cleanup running, interrupting fiber.`,
          undefined,
          "NoteDetail:cleanup",
        ),
      );
      runClientUnscoped(Fiber.interrupt(fiber));
    },
  };
};
