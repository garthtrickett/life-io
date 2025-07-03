// components/pages/notes/list/types.ts
import type { TemplateResult } from "lit-html";
import type { Note } from "../../../../types/generated/public/Note";

export interface ViewResult {
  template: TemplateResult;
  cleanup?: () => void;
}

export interface Model {
  notes: Note[];
  isLoading: boolean;
  isCreating: boolean;
  error: string | null;
}

export type Action =
  | { type: "NOTES_UPDATED"; payload: Note[] }
  | { type: "DATA_ERROR"; payload: string }
  | { type: "CREATE_NOTE_START" }
  | { type: "CREATE_NOTE_SUCCESS"; payload: Note }
  | { type: "CREATE_NOTE_ERROR"; payload: string }
  | { type: "SORT_NOTES_AZ" };
