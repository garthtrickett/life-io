// components/pages/notes/detail/types.ts
import type { TemplateResult } from "lit-html";
import { Data, Fiber } from "effect";
import type { Note } from "../../../../types/generated/public/Note";
import type { Block } from "../../../../types/generated/public/Block";

export class NoteSaveError extends Data.TaggedError("NoteSaveError")<{
  readonly message: string;
}> {}

export interface ViewResult {
  template: TemplateResult;
  cleanup?: () => void;
}

export interface Model {
  status: "loading" | "idle" | "saving" | "error";
  note: Note | null;
  blocks: Block[];
  error: string | null;
  saveFiber: Fiber.Fiber<void, void> | null;
}

export type Action =
  | { type: "DATA_UPDATED"; payload: { note: Note | null; blocks: Block[] } }
  | { type: "DATA_ERROR"; payload: string }
  | {
      type: "UPDATE_NOTE_CONTENT";
      payload: { title?: string; content?: string };
    }
  | { type: "SAVE_START" }
  | { type: "SAVE_SUCCESS" }
  | { type: "SAVE_ERROR"; payload: NoteSaveError };
