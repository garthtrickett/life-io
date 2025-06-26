// FILE: types/generated/index.ts
// --- This file is correct ---
import type User from "./User";
import type Note from "./Note";
import type Tag from "./Tag";
import type NoteTag from "./NoteTag";

export default interface Database {
  user: User;
  note: Note;
  tag: Tag;
  note_tag: NoteTag;
}
