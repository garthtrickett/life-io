// File: ./components/pages/note-detail-page.ts
import { render, html, type TemplateResult } from "lit-html";
import { pipe, Effect, Data, Queue, Ref, Fiber, Stream } from "effect";
import { runClientUnscoped } from "../../lib/client/runtime";
import type { Note } from "../../types/generated/public/Note";
import type { Block } from "../../types/generated/public/Block";
import styles from "./NoteDetailView.module.css";
import { trpc } from "../../lib/client/trpc";
import { clientLog } from "../../lib/client/logger.client";
import { rep } from "../../lib/client/replicache";
import { repeat } from "lit-html/directives/repeat.js";
import { Schema } from "@effect/schema";
import { BlockSchema } from "../../lib/shared/schemas";

// --- Custom Error Types ---
// class NoteDataError extends Data.TaggedError("NoteDataError")<{
//   readonly message: string;
// }> {}
class NoteSaveError extends Data.TaggedError("NoteSaveError")<{
  readonly message: string;
}> {}

// --- Types ---
interface ViewResult {
  template: TemplateResult;
  cleanup?: () => void;
}

interface Model {
  status: "loading" | "idle" | "saving" | "error";
  note: Note | null;
  blocks: Block[];
  error: string | null;
  saveFiber: Fiber.Fiber<void, void> | null;
}

// --- Action ---
type Action =
  | { type: "DATA_UPDATED"; payload: { note: Note | null; blocks: Block[] } }
  | { type: "DATA_ERROR"; payload: string }
  | {
      type: "UPDATE_NOTE_CONTENT";
      payload: { title?: string; content?: string };
    }
  | { type: "SAVE_START" }
  | { type: "SAVE_SUCCESS" }
  | { type: "SAVE_ERROR"; payload: NoteSaveError };

export const NoteDetailView = (id: string): ViewResult => {
  const container = document.createElement("div");
  const componentProgram = Effect.gen(function* () {
    // --- State and Action Queue ---
    const model = yield* Ref.make<Model>({
      status: "loading",
      note: null,
      blocks: [],
      error: null,
      saveFiber: null,
    });
    const actionQueue = yield* Queue.unbounded<Action>();

    // --- Propose Action ---
    const propose = (action: Action) =>
      runClientUnscoped(
        pipe(
          clientLog(
            "debug",
            `NoteDetailView(${id}): Proposing action ${action.type}`,
          ),
          Effect.andThen(() => Queue.offer(actionQueue, action)),
        ),
      );

    // --- Pure Render Function ---
    const renderView = (currentModel: Model) => {
      const renderStatus = () => {
        switch (currentModel.status) {
          case "saving":
            return html`Saving...`;
          case "error":
            return html`<span class="text-red-500"
              >${currentModel.error}</span
            >`;
          default:
            return html``;
        }
      };

      const renderChildBlock = (block: Block) => html`
        <div class="ml-4 mt-1 rounded-md bg-zinc-50 p-2 text-sm text-zinc-700">
          <strong class="text-xs text-zinc-400">[${block.type}]</strong>
          ${block.content}
        </div>
      `;

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
                        propose({
                          type: "UPDATE_NOTE_CONTENT",
                          payload: {
                            title: (e.target as HTMLInputElement).value,
                          },
                        })}
                      class=${styles.titleInput}
                      ?disabled=${currentModel.status === "saving"}
                    />
                    <textarea
                      class=${styles.contentInput}
                      .value=${currentModel.note.content}
                      @input=${(e: Event) =>
                        propose({
                          type: "UPDATE_NOTE_CONTENT",
                          payload: {
                            content: (e.target as HTMLTextAreaElement).value,
                          },
                        })}
                      ?disabled=${currentModel.status === "saving"}
                      placeholder="Type your markdown here..."
                    ></textarea>
                    <div class="mt-8">
                      <h3
                        class="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500"
                      >
                        Parsed Blocks (Live View)
                      </h3>
                      ${currentModel.blocks.length > 0
                        ? repeat(
                            currentModel.blocks,
                            (block) => block.id,
                            (block) => renderChildBlock(block),
                          )
                        : html`<p class="text-sm text-zinc-400">
                            No blocks parsed from content yet.
                          </p>`}
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
          const currentModel = yield* Ref.get(model);
          switch (action.type) {
            case "DATA_UPDATED":
              yield* Ref.update(
                model,
                (m): Model => ({
                  ...m,
                  status: "idle",
                  note: action.payload.note,
                  blocks: action.payload.blocks,
                  error: null,
                }),
              );
              break;

            case "DATA_ERROR":
              yield* Ref.update(
                model,
                (m): Model => ({
                  ...m,
                  status: "error",
                  note: null,
                  blocks: [],
                  error: action.payload,
                }),
              );
              break;

            case "UPDATE_NOTE_CONTENT":
              if (currentModel.note) {
                const updatedNote = { ...currentModel.note, ...action.payload };
                yield* Ref.update(
                  model,
                  (m): Model => ({
                    ...m,
                    note: updatedNote,
                    status: "idle",
                    error: null,
                  }),
                );

                if (currentModel.saveFiber) {
                  yield* Fiber.interrupt(currentModel.saveFiber);
                }
                const saveFiber = yield* pipe(
                  Effect.sleep("500 millis"),
                  Effect.andThen(() => propose({ type: "SAVE_START" })),
                  Effect.asVoid,
                  Effect.fork,
                );
                yield* Ref.update(model, (m): Model => ({ ...m, saveFiber }));
              }
              break;

            case "SAVE_START": {
              if (!currentModel.note) return;
              yield* Ref.update(
                model,
                (m): Model => ({ ...m, status: "saving" }),
              );

              const saveEffect = pipe(
                Effect.tryPromise({
                  try: () =>
                    trpc.note.update.mutate({
                      id: currentModel.note!.id,
                      title: currentModel.note!.title,
                      content: currentModel.note!.content,
                    }),
                  catch: (err) =>
                    new NoteSaveError({
                      message:
                        err instanceof Error
                          ? err.message
                          : "An unknown error occurred.",
                    }),
                }),
                Effect.matchEffect({
                  onSuccess: () => propose({ type: "SAVE_SUCCESS" }),
                  onFailure: (error) =>
                    propose({ type: "SAVE_ERROR", payload: error }),
                }),
              );

              yield* Effect.fork(saveEffect);
              break;
            }

            case "SAVE_SUCCESS":
              yield* Ref.update(
                model,
                (m): Model => ({ ...m, status: "idle" }),
              );
              break;

            case "SAVE_ERROR":
              yield* Ref.update(
                model,
                (m): Model => ({
                  ...m,
                  status: "error",
                  error: action.payload.message,
                }),
              );
              break;
          }
        }),
      );

    // --- Data Subscription Stream from Replicache ---
    const replicacheStream: Stream.Stream<
      { note: Note | null; blocks: Block[] },
      string
    > = Stream.async((emit) => {
      let isInitialLoad = true;
      const unsubscribe = rep.subscribe(
        async (tx) => {
          const note = (await tx.get(`note/${id}`)) as Note | null;
          if (!note) return { note: null, blocks: [] };
          const blockJSONs = await tx
            .scan({ prefix: "block/" })
            .values()
            .toArray();
          const blocks = blockJSONs.flatMap((json) => {
            try {
              return [
                Schema.decodeUnknownSync(BlockSchema)(json, {
                  onExcessProperty: "ignore",
                }),
              ];
            } catch {
              return [];
            }
          });
          const filteredBlocks = blocks
            .filter((b) => b.note_id === id)
            .sort((a, b) => a.order - b.order);
          return { note, blocks: filteredBlocks };
        },
        {
          onData: (data) => {
            // --- Added Logging ---
            void clientLog(
              "debug",
              `Replicache onData received for note ${id}. Note found: ${!!data.note}. Blocks: ${data.blocks.length}`,
              undefined,
              "Replicache:onData",
            );

            if (data.note) {
              isInitialLoad = false;
              // FIX: Explicitly ignore the returned promise with `void`
              void emit.single(data);
            } else if (!isInitialLoad) {
              // FIX: Explicitly ignore the returned promise with `void`
              void emit.fail(`Note with ID ${id} not found.`);
            }
          },
        },
      );
      return Effect.sync(unsubscribe);
    });

    // --- Main Loop ---
    const renderEffect = Ref.get(model).pipe(Effect.tap(renderView));
    yield* renderEffect;

    const mainLoop = Effect.gen(function* () {
      const actionProcessor = Queue.take(actionQueue).pipe(
        Effect.flatMap(handleAction),
        Effect.andThen(renderEffect),
        Effect.forever,
      );
      const dataSubscriber = replicacheStream.pipe(
        Stream.flatMap((data) =>
          Stream.fromEffect(propose({ type: "DATA_UPDATED", payload: data })),
        ),
        Stream.catchAll((err) =>
          Stream.fromEffect(propose({ type: "DATA_ERROR", payload: err })),
        ),
        Stream.runDrain,
      );
      yield* Effect.all([actionProcessor, dataSubscriber], {
        concurrency: "unbounded",
      });
    }).pipe(
      Effect.catchAllDefect((defect) =>
        clientLog(
          "error",
          `[FATAL] Uncaught defect in NoteDetailView main loop: ${String(
            defect,
          )}`,
        ),
      ),
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
        ),
      );
      runClientUnscoped(Fiber.interrupt(fiber));
    },
  };
};
