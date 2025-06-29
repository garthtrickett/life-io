// FILE: trpc/routers/note.ts
import { router, createPermissionProtectedProcedure } from "../trpc";
import { t } from "elysia";
import { compile } from "@elysiajs/trpc";
import { createNote } from "../../features/notes/createNote";
import { getNotes } from "../../features/notes/getNotes";
import { getNote } from "../../features/notes/getNote";
import { updateNote } from "../../features/notes/updateNote";
import { DbLayer } from "../../db/DbLayer";
import { Effect, Cause } from "effect";
import { perms } from "../../lib/shared/permissions";
import type { NewNote, NoteId } from "../../types/generated/public/Note";
import { serverLog } from "../../lib/server/logger.server";

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
      const logRequest = serverLog(
        "info",
        `[TRPC] getById received for id: ${id}`,
        ctx.user.id,
        "noteRouter:getById",
      );
      const program = getNote(id, ctx.user.id).pipe(
        Effect.provide(DbLayer),
        Effect.tap((result) =>
          serverLog(
            "info",
            `[TRPC] getById program finished. Found note: ${!!result}`,
            ctx.user.id,
            "noteRouter:getById:program",
          ),
        ),
        Effect.tapErrorCause((cause) =>
          serverLog(
            "error",
            `[TRPC] getById program failed: ${Cause.pretty(cause)}`,
            ctx.user.id,
            "noteRouter:getById:program",
          ),
        ),
      );

      return Effect.runPromise(Effect.zipRight(logRequest, program));
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
