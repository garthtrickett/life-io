// FILE: trpc/routers/note.ts
import { router, createPermissionProtectedProcedure } from "../trpc";
import { t } from "elysia";
import { compile } from "@elysiajs/trpc";
import { createNote } from "../../features/notes/createNote";
import { getNotes } from "../../features/notes/getNotes";
import { getNote } from "../../features/notes/getNote";
import { updateNote } from "../../features/notes/updateNote";
import { DbLayer } from "../../db/DbLayer";
import { Effect } from "effect";
import { perms } from "../../lib/shared/permissions";
import type { NewNote, NoteId } from "../../types/generated/public/Note";

const CreateNoteInput = t.Object({
  title: t.String({ minLength: 1 }),
  content: t.String(),
});

const GetByIdInput = t.Object({
  id: t.String({ format: "uuid" }),
});

const UpdateNoteInput = t.Object({
  id: t.String({ format: "uuid" }),
  title: t.String({ minLength: 1 }),
  content: t.String(),
});

export const noteRouter = router({
  list: createPermissionProtectedProcedure(perms.note.read).query(
    async ({ ctx }) => {
      const program = getNotes(ctx.user.id).pipe(Effect.provide(DbLayer));
      return Effect.runPromise(program);
    },
  ),

  getById: createPermissionProtectedProcedure(perms.note.read)
    .input(compile(GetByIdInput))
    .query(async ({ input, ctx }) => {
      const { id } = input as typeof GetByIdInput.static;
      const program = getNote(id, ctx.user.id).pipe(Effect.provide(DbLayer));
      return Effect.runPromise(program);
    }),

  create: createPermissionProtectedProcedure(perms.note.write)
    .input(compile(CreateNoteInput))
    .mutation(async ({ input, ctx }) => {
      const { title, content } = input as typeof CreateNoteInput.static;
      const noteData: NewNote = {
        title,
        content,
        user_id: ctx.user.id,
      };
      const program = createNote(noteData).pipe(Effect.provide(DbLayer));
      return Effect.runPromise(program);
    }),

  update: createPermissionProtectedProcedure(perms.note.write)
    .input(compile(UpdateNoteInput))
    .mutation(async ({ input, ctx }) => {
      const { id, ...noteUpdateData } = input as typeof UpdateNoteInput.static;
      const program = updateNote(
        id as NoteId,
        ctx.user.id,
        noteUpdateData,
      ).pipe(Effect.provide(DbLayer));
      return Effect.runPromise(program);
    }),
});
