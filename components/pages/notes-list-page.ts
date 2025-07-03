// FILE: components/pages/notes-list-page.ts
import { html } from "lit-html";
import { pipe, Effect, Queue, Ref, Fiber, Stream, Either } from "effect";
import { Schema } from "@effect/schema";
import { animate, stagger } from "motion";

import { runClientUnscoped } from "../../lib/client/runtime";
import { rep } from "../../lib/client/replicache";
import { clientLog } from "../../lib/client/logger.client";
import { NoteSchema } from "../../lib/shared/schemas";
import type { Note } from "../../types/generated/public/Note";

import { handleAction } from "./notes/list/actions";
import { renderView } from "./notes/list/view";
import type { ViewResult, Model, Action } from "./notes/list/types";

// --- View Entry Point ---
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

    const renderEffect = pipe(
      Ref.get(model),
      Effect.tap((m) => renderView(container, m, propose)),
      Effect.tap((m) =>
        clientLog(
          "debug",
          `Rendering NotesView with state: ${JSON.stringify(m)}`,
          undefined,
          "NotesView:render",
        ),
      ),
      // Animation logic is now a side-effect of rendering.
      Effect.tap((m) =>
        Effect.sync(() => {
          if (!m.isLoading && m.notes.length > 0) {
            // A small delay to ensure the DOM is updated before animating.
            requestAnimationFrame(() => {
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
            });
          }
        }),
      ),
    );

    // --- Data subscription stream from Replicache ---
    const replicacheStream = Stream.async<Note[]>((emit) => {
      const unsubscribe = rep.subscribe(
        async (tx) => {
          const noteJSONs = await tx
            .scan({ prefix: "note/" })
            .values()
            .toArray();
          const notes = noteJSONs.flatMap((json) => {
            const decoded = Schema.decodeUnknownEither(NoteSchema)(json);
            if (Either.isRight(decoded)) {
              return [decoded.right];
            }
            // FIX: Log decoding errors for debugging
            void clientLog(
              "error",
              `Failed to decode note from Replicache: ${JSON.stringify(
                decoded.left,
              )}`,
              undefined,
              "NotesView:ReplicacheDecoder",
            );
            return [];
          });
          return notes.sort(
            (a, b) =>
              new Date(b.updated_at).getTime() -
              new Date(a.updated_at).getTime(),
          );
        },
        {
          onData: (data: Note[]) => {
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

    // --- Main Application Loop ---
    const mainLoop = Effect.gen(function* () {
      const actionProcessor = Queue.take(actionQueue).pipe(
        Effect.flatMap((action) => handleAction(action, model)),
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
