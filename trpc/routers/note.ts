// FILE: trpc/routers/note.ts
import { router, createPermissionProtectedProcedure } from "../trpc";
import { getNotes } from "../../features/notes/getNotes";
import { getNote } from "../../features/notes/getNote";
import { updateNote } from "../../features/notes/updateNote";
import { perms } from "../../lib/shared/permissions";
import { runServerPromise } from "../../lib/server/runtime";
import { NoteIdSchema } from "../../lib/shared/schemas";

// --- Schema Imports ---
import { Schema } from "@effect/schema";
import { s } from "../validator";

const GetByIdInput = Schema.Struct({
  id: NoteIdSchema,
});

const UpdateNoteInput = Schema.Struct({
  id: NoteIdSchema,
  title: Schema.String.pipe(
    Schema.minLength(1, { message: () => "Title cannot be empty." }),
  ),
  content: Schema.String,
});

export const noteRouter = router({
  list: createPermissionProtectedProcedure(perms.note.read).query(({ ctx }) =>
    runServerPromise(getNotes(ctx.user.id)),
  ),

  getById: createPermissionProtectedProcedure(perms.note.read)
    .input(s(GetByIdInput))
    .query(({ input, ctx }) => {
      // The getNote feature still returns a single Note, not its blocks.
      // The client page gets the blocks via Replicache subscription.
      return runServerPromise(getNote(input.id, ctx.user.id));
    }),

  update: createPermissionProtectedProcedure(perms.note.write)
    .input(s(UpdateNoteInput))
    .mutation(({ input, ctx }) => {
      const { id, ...noteUpdateData } = input;
      // This now correctly calls the refactored updateNote feature
      return runServerPromise(updateNote(id, ctx.user.id, noteUpdateData));
    }),
});
