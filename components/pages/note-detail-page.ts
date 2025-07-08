// FILE: components/pages/note-detail-page.ts
import { html } from "lit-html";
import { pipe, Effect, Queue, Ref, Fiber, Stream } from "effect";
import { Schema } from "@effect/schema";

import { runClientUnscoped } from "../../lib/client/runtime";
import { rep } from "../../lib/client/replicache";
import { clientLog } from "../../lib/client/logger.client";
import { BlockSchema, NoteSchema } from "../../lib/shared/schemas";

import type { Note } from "../../types/generated/public/Note";
import type { Block } from "../../types/generated/public/Block";

import { handleAction } from "./notes/detail/actions";
import { renderView } from "./notes/detail/view";
import type { ViewResult, Model, Action } from "./notes/detail/types";

export const NoteDetailView = (id: string): ViewResult => {
  const container = document.createElement("div");

  const componentProgram = Effect.gen(function* () {
    const model = yield* Ref.make<Model>({
      status: "loading",
      note: null,
      blocks: [],
      error: null,
      saveFiber: null,
    });
    const actionQueue = yield* Queue.unbounded<Action>();

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

    const renderEffect = Ref.get(model).pipe(
      Effect.tap((m) => renderView(container, m, propose)),
      Effect.tap(() =>
        clientLog(
          "debug",
          `Rendering NoteDetailView with state:
            ...m,
            saveFiber: m.saveFiber ? "FIBER_EXISTS" : null,
          })}`,
          undefined,
          `NoteDetailView(${id}):render`,
        ),
      ),
    );

    const replicacheStream: Stream.Stream<
      { note: Note | null; blocks: Block[] },
      string
    > = Stream.async((emit) => {
      if (!rep) {
        void emit.fail("Replicache is not initialized.");
        return;
      }

      let isInitialLoad = true;
      const unsubscribe = rep.subscribe(
        async (tx) => {
          const noteJSON = await tx.get(`note/${id}`);
          if (!noteJSON) return { note: null, blocks: [] };
          const note = Schema.decodeUnknownSync(NoteSchema)(noteJSON, {
            onExcessProperty: "ignore",
          });

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
            } catch (e) {
              void clientLog(
                "error",
                `Failed to decode block from Replicache: ${String(e)}`,
                undefined,
                "NoteDetailView:ReplicacheDecoder",
              );
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
            void clientLog(
              "debug",
              `Replicache onData for note ${id}. Note: ${!!data.note}. Blocks: ${data.blocks.length}`,
              undefined,
              "Replicache:onData",
            );
            const wasInitialLoad = isInitialLoad;
            isInitialLoad = false;
            if (data.note) {
              void emit.single(data);
            } else if (!wasInitialLoad) {
              void emit.fail(`Note with ID ${id} not found.`);
            }
          },
        },
      );
      return Effect.sync(unsubscribe);
    });

    const mainLoop = Effect.gen(function* () {
      const actionProcessor = Queue.take(actionQueue).pipe(
        Effect.flatMap((action) => handleAction(action, model, propose)),
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
      yield* renderEffect; // Initial render
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
