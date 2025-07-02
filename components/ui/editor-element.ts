// File: ./components/ui/editor-element.ts
import { html, render, type TemplateResult } from "lit-html";
import { pipe, Effect, Queue, Ref, Fiber } from "effect";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

import { runClientUnscoped } from "../../lib/client/runtime";
import { clientLog } from "../../lib/client/logger.client";
import styles from "./EditorElement.module.css";

// --- Types ---

export interface EditorProps {
  initialContent: string;
}

interface ViewResult {
  template: TemplateResult;
  cleanup?: () => void;
}

interface Model {
  editor: Editor | null;
}

type Action =
  | { type: "INIT_EDITOR"; payload: { element: HTMLElement; content: string } }
  | { type: "DESTROY_EDITOR" };

// --- View ---

export const EditorView = (props: EditorProps): ViewResult => {
  const container = document.createElement("div");
  container.classList.add(styles.editorWrapper);

  const componentProgram = Effect.gen(function* () {
    // --- State and Action Queue ---
    const model = yield* Ref.make<Model>({ editor: null });
    const actionQueue = yield* Queue.unbounded<Action>();

    // --- Propose Action ---
    const propose = (action: Action) =>
      Effect.runFork(
        pipe(
          clientLog(
            "debug",
            `EditorView: Proposing action ${action.type}`,
            undefined,
            "EditorView:propose",
          ),
          Effect.andThen(Queue.offer(actionQueue, action)),
        ),
      );

    // --- Action Handler (Update + React) ---
    const handleAction = (action: Action): Effect.Effect<void> =>
      Effect.gen(function* () {
        const currentModel = yield* Ref.get(model);
        switch (action.type) {
          case "INIT_EDITOR": {
            if (currentModel.editor) return;

            const editor = new Editor({
              element: action.payload.element,
              extensions: [StarterKit],
              content: action.payload.content,
              editorProps: {
                attributes: {
                  class: styles.proseMirror,
                },
              },
              onUpdate: ({ editor }) => {
                const updatedContent = editor.getHTML();
                const event = new CustomEvent("editor-update", {
                  detail: { content: updatedContent },
                  bubbles: true,
                  composed: true,
                });
                container.dispatchEvent(event);
              },
            });

            yield* Ref.set(model, { editor });
            yield* clientLog(
              "info",
              "TipTap editor initialized.",
              undefined,
              "EditorView",
            );
            break;
          }
          case "DESTROY_EDITOR": {
            if (currentModel.editor) {
              yield* clientLog(
                "info",
                "Destroying TipTap editor instance.",
                undefined,
                "EditorView",
              );
              yield* Effect.sync(() => currentModel.editor?.destroy());
              yield* Ref.set(model, { editor: null });
            }
            break;
          }
        }
      });

    // --- Main Loop ---
    yield* Effect.sync(() => {
      render(html`<div class=${styles.editorContent}></div>`, container);
      const editorElement = container.querySelector<HTMLElement>(
        `.${styles.editorContent}`,
      );
      if (editorElement) {
        propose({
          type: "INIT_EDITOR",
          payload: {
            element: editorElement,
            content: props.initialContent,
          },
        });
      }
    });

    yield* Queue.take(actionQueue).pipe(
      Effect.flatMap(handleAction),
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
          "EditorView cleanup running, interrupting fiber.",
          undefined,
          "EditorView:cleanup",
        ),
      );
      runClientUnscoped(Fiber.interrupt(fiber));
    },
  };
};
