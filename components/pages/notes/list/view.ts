// components/pages/notes/list/view.ts
import { html, render } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import { navigate } from "../../../../lib/client/router";
import styles from "../../NotesView.module.css";
import type { Model, Action } from "./types";
import { runClientUnscoped } from "../../../../lib/client/runtime";

export const renderView = (
  container: HTMLElement,
  currentModel: Model,
  propose: (action: Action) => void,
) => {
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
      return html` <div class=${styles.emptyState}></div> `;
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
                  runClientUnscoped(navigate(`/notes/${note.id}`));
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
