// FILE: trpc/routers/note.ts
import { router, createPermissionProtectedProcedure } from "../trpc";
import { createNote } from "../../features/notes/createNote";
import { getNotes } from "../../features/notes/getNotes";
import { getNote } from "../../features/notes/getNote";
import { updateNote } from "../../features/notes/updateNote";
import { perms } from "../../lib/shared/permissions";
import type { NewNote } from "../../types/generated/public/Note";
import { runServerPromise } from "../../lib/server/runtime";
import { NoteIdSchema } from "../../lib/shared/schemas";

// --- Schema Imports ---
import { Schema } from "@effect/schema";
import { s } from "../validator";

// --- Input Schemas defined with Effect Schema ---
const CreateNoteInput = Schema.Struct({
  title: Schema.String.pipe(
    // --- FIX: In newer versions of @effect/schema, message must be a function ---
    Schema.minLength(1, { message: () => "Title cannot be empty." }),
  ),
  content: Schema.String,
});
const GetByIdInput = Schema.Struct({
  id: NoteIdSchema,
});

const UpdateNoteInput = Schema.Struct({
  id: NoteIdSchema,
  title: Schema.String.pipe(
    // --- FIX: In newer versions of @effect/schema, message must be a function ---
    Schema.minLength(1, { message: () => "Title cannot be empty." }),
  ),
  content: Schema.String,
});

// --- REMOVED HELPER ---

export const noteRouter = router({
  // --- FIX: Directly use runServerPromise as type inference is now correct ---
  list: createPermissionProtectedProcedure(perms.note.read).query(({ ctx }) =>
    runServerPromise(getNotes(ctx.user.id)),
  ),

  getById: createPermissionProtectedProcedure(perms.note.read)
    .input(s(GetByIdInput))
    .query(({ input, ctx }) => {
      return runServerPromise(getNote(input.id, ctx.user.id));
    }),

  create: createPermissionProtectedProcedure(perms.note.write)
    .input(s(CreateNoteInput))
    .mutation(({ input, ctx }) => {
      const noteData: NewNote = {
        ...input,
        user_id: ctx.user.id,
      };
      return runServerPromise(createNote(noteData));
    }),

  update: createPermissionProtectedProcedure(perms.note.write)
    .input(s(UpdateNoteInput))
    .mutation(({ input, ctx }) => {
      const { id, ...noteUpdateData } = input;
      return runServerPromise(updateNote(id, ctx.user.id, noteUpdateData));
    }),
});
