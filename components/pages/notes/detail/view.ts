// components/pages/notes/detail/view.ts
import { html, render, nothing } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import styles from "../../NoteDetailView.module.css";
import type { Model, Action } from "./types";
import type { Block } from "../../../../types/generated/public/Block";

export const renderView = (
  container: HTMLElement,
  currentModel: Model,
  propose: (action: Action) => void,
) => {
  const renderStatus = () => {
    switch (currentModel.status) {
      case "saving":
        return html`Saving...`;
      case "error":
        return html`<span class="text-red-500">${currentModel.error}</span>`;
      default:
        return nothing;
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
