// File: ./components/ui/editor-element.ts
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import styles from "./EditorElement.module.css";
import { clientLog } from "../../lib/client/logger.client";
import { runClientUnscoped } from "../../lib/client/runtime";

export class EditorElement extends HTMLElement {
  private editor: Editor | null = null;
  private _content: string = "";

  set content(value: string) {
    this._content = value;
    if (this.editor) {
      if (this.editor.getHTML() !== value) {
        this.editor.commands.setContent(value, false);
      }
    }
  }

  connectedCallback() {
    this.innerHTML = `<div class="${styles.editorContent}"></div>`;
    const editorElement = this.querySelector<HTMLElement>(
      `.${styles.editorContent}`,
    );

    if (editorElement) {
      this.editor = new Editor({
        element: editorElement,
        extensions: [StarterKit],
        content: this._content,
        editorProps: {
          attributes: {
            class: styles.proseMirror,
          },
        },
        onUpdate: ({ editor }) => {
          const event = new CustomEvent("editor-update", {
            detail: { content: editor.getHTML() },
            bubbles: true,
            composed: true,
          });
          this.dispatchEvent(event);
        },
      });

      runClientUnscoped(
        clientLog(
          "info",
          "TipTap editor initialized.",
          undefined,
          "EditorElement",
        ),
      );
    }
  }

  disconnectedCallback() {
    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
      runClientUnscoped(
        clientLog(
          "info",
          "TipTap editor destroyed.",
          undefined,
          "EditorElement",
        ),
      );
    }
  }
}

customElements.define("editor-element", EditorElement);
