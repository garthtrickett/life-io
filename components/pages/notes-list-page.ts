// FILE: components/pages/notes-list-page.ts
import { render, html, type TemplateResult } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import { pipe, Effect, Queue, Ref, Fiber, Stream, Either } from "effect"; // Import Either
import { runClientUnscoped } from "../../lib/client/runtime";
import type { Note } from "../../types/generated/public/Note";
import styles from "./NotesView.module.css";
import { navigate } from "../../lib/client/router";
import { clientLog } from "../../lib/client/logger.client";
import { trpc } from "../../lib/client/trpc";
import { animate, stagger } from "motion";
import { rep } from "../../lib/client/replicache";
import { Schema } from "@effect/schema"; // Import Schema
import { NoteSchema } from "../../lib/shared/schemas"; // Import the schema for validation

// --- Types ---
interface ViewResult {
  template: TemplateResult;
  cleanup?: () => void;
}

interface Model {
  notes: Note[];
  isLoading: boolean;
  isCreating: boolean;
  error: string | null;
}

type Action =
  | { type: "NOTES_UPDATED"; payload: Note[] }
  | { type: "DATA_ERROR"; payload: string }
  | { type: "CREATE_NOTE_START" }
  | { type: "CREATE_NOTE_SUCCESS"; payload: Note }
  | { type: "CREATE_NOTE_ERROR"; payload: string }
  | { type: "SORT_NOTES_AZ" };

// --- View ---
export const NotesView = (): ViewResult => {
  const container = document.createElement("div");
  const componentProgram = Effect.gen(function* () {
    const model = yield* Ref.make<Model>({
      notes: [],
      isLoading: true,
      isCreating: false,
      error: null,
    });
    const actionQueue = yield* Queue.unbounded<Action>();

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

    const renderView = (currentModel: Model) => {
      const renderNotes = () => {
        if (currentModel.isLoading) {
          return html`
            <div class=${styles.skeletonContainer}>
              ${repeat(
                [1, 2, 3],
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

    const handleAction = (action: Action): Effect.Effect<void> =>
      Effect.gen(function* () {
        const currentModel = yield* Ref.get(model);
        switch (action.type) {
          case "NOTES_UPDATED": {
            yield* Ref.set(model, {
              ...currentModel,
              isLoading: false,
              notes: action.payload,
            });
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
          case "DATA_ERROR":
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
              Effect.tryPromise({
                try: () =>
                  trpc.note.create.mutate({
                    title: "Untitled Note",
                    content: "",
                  }),
                catch: (e) => e as Error,
              }),
              Effect.flatMap((note) =>
                note && typeof note === "object" && "id" in note
                  ? Effect.succeed(note)
                  : Effect.fail(new Error("Server did not return a note.")),
              ),
              Effect.match({
                onSuccess: (note) =>
                  propose({ type: "CREATE_NOTE_SUCCESS", payload: note }),
                onFailure: (e) =>
                  propose({ type: "CREATE_NOTE_ERROR", payload: e.message }),
              }),
            );
            yield* Effect.fork(createEffect);
            break;
          }
          case "CREATE_NOTE_SUCCESS":
            yield* Ref.set(model, { ...currentModel, isCreating: false });

            // --- FIX: Manually trigger a Replicache pull ---
            // This ensures the client fetches the newly created note from the server
            // so it's available in the cache when we navigate to the detail page.
            yield* Effect.promise(() => rep.pull());

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

    // --- Data subscription stream from Replicache ---
    const replicacheStream = Stream.async<Note[]>((emit) => {
      const unsubscribe = rep.subscribe(
        async (tx) => {
          // --- FIX START ---
          const noteJSONs = await tx
            .scan({ prefix: "note/" })
            .values()
            .toArray();
          const notes = noteJSONs.flatMap((json) => {
            const decoded = Schema.decodeUnknownEither(NoteSchema)(json);
            if (Either.isRight(decoded)) {
              return [decoded.right];
            }
            // Silently ignore invalid data in the cache
            return [];
          });

          return notes.sort(
            (a, b) =>
              new Date(b.updated_at).getTime() -
              new Date(a.updated_at).getTime(),
          );
          // --- FIX END ---
        },
        {
          onData: (data: Note[]) => {
            // The data is now correctly typed
            void clientLog(
              "debug",
              `Replicache onData received for notes list. Notes: ${data.length}`,
              undefined,
              "NotesView:onData",
            );
            void emit.single(data);
          },
        },
      );
      return Effect.sync(unsubscribe);
    });

    const mainLoop = Effect.gen(function* () {
      const actionProcessor = Queue.take(actionQueue).pipe(
        Effect.flatMap(handleAction),
        Effect.andThen(renderEffect),
        Effect.forever,
      );
      const dataSubscriber = replicacheStream.pipe(
        Stream.flatMap((data) =>
          Stream.fromEffect(propose({ type: "NOTES_UPDATED", payload: data })),
        ),
        Stream.catchAll((err) =>
          Stream.fromEffect(
            propose({ type: "DATA_ERROR", payload: String(err) }),
          ),
        ),
        Stream.runDrain,
      );
      yield* renderEffect; // Initial render
      yield* Effect.all([actionProcessor, dataSubscriber], {
        concurrency: "unbounded",
      });
    }).pipe(
      Effect.catchAllDefect((defect) =>
        clientLog(
          "error",
          `[FATAL] Uncaught defect in NotesView main loop: ${String(defect)}`,
        ),
      ),
    );

    yield* mainLoop;
  });

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
