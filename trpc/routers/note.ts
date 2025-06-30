// FILE: trpc/routers/note.ts
import { router, createPermissionProtectedProcedure } from "../trpc";
import { t } from "elysia";
import { compile } from "@elysiajs/trpc";
import { createNote } from "../../features/notes/createNote";
import { getNotes } from "../../features/notes/getNotes";
import { getNote } from "../../features/notes/getNote";
import { updateNote } from "../../features/notes/updateNote";
import { Effect } from "effect";
import { perms } from "../../lib/shared/permissions";
import type { NewNote } from "../../types/generated/public/Note";
import { runServerPromise } from "../../lib/server/runtime";
import { TRPCError } from "@trpc/server";
import { NoteIdSchema } from "../../lib/shared/schemas";
import { Db } from "../../db/DbTag";

const CreateNoteInput = t.Object({
  title: t.String({ minLength: 1 }),
  content: t.String(),
});

// Use the imported schema here
const GetByIdInput = t.Object({
  id: NoteIdSchema,
});

// And here
const UpdateNoteInput = t.Object({
  id: NoteIdSchema,
  title: t.String({ minLength: 1 }),
  content: t.String(),
});

/**
 * A helper function to run an Effect and automatically translate any
 * Error in the failure channel into a TRPCError with a 'BAD_REQUEST' code,
 * which is suitable for validation failures.
 */
const runEffectAsTrpc = <A,>(
  eff: Effect.Effect<A, Error, Db>, // FIX: The context is now correctly typed as Db
): Promise<A> => {
  const program = Effect.catchAll(eff, (e) =>
    Effect.fail(new TRPCError({ code: "BAD_REQUEST", message: e.message })),
  );
  return runServerPromise(program);
};

export const noteRouter = router({
  list: createPermissionProtectedProcedure(perms.note.read).query(({ ctx }) =>
    runEffectAsTrpc(getNotes(ctx.user.id)),
  ),

  getById: createPermissionProtectedProcedure(perms.note.read)
    .input(compile(GetByIdInput))
    .query(({ input, ctx }) => {
      const { id } = input as typeof GetByIdInput.static;
      return runEffectAsTrpc(getNote(id, ctx.user.id));
    }),

  create: createPermissionProtectedProcedure(perms.note.write)
    .input(compile(CreateNoteInput))
    .mutation(({ input, ctx }) => {
      const { title, content } = input as typeof CreateNoteInput.static;
      const noteData: NewNote = {
        title,
        content,
        user_id: ctx.user.id,
      };
      return runEffectAsTrpc(createNote(noteData));
    }),

  update: createPermissionProtectedProcedure(perms.note.write)
    .input(compile(UpdateNoteInput))
    .mutation(({ input, ctx }) => {
      const { id, ...noteUpdateData } = input as typeof UpdateNoteInput.static;
      // FIX: Removed the unnecessary and incorrect `as NoteId` cast
      return runEffectAsTrpc(updateNote(id, ctx.user.id, noteUpdateData));
    }),
});
