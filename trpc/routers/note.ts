// FILE: trpc/routers/note.ts
import { router, createPermissionProtectedProcedure } from "../trpc";
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

// --- Schema Imports ---
import { Schema } from "@effect/schema";
import { s } from "../validator";

// --- Input Schemas defined with Effect Schema ---
const CreateNoteInput = Schema.Struct({
  title: Schema.String.pipe(
    // FIX: The message is now a function that returns a string.
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
    // FIX: The message is now a function that returns a string.
    Schema.minLength(1, { message: () => "Title cannot be empty." }),
  ),
  content: Schema.String,
});

/**
 * A helper function to run an Effect and automatically translate any
 * Error in the failure channel into a TRPCError with a 'BAD_REQUEST' code,
 * which is suitable for validation failures.
 */
const runEffectAsTrpc = <A,>(eff: Effect.Effect<A, Error, Db>): Promise<A> => {
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
    .input(s(GetByIdInput))
    .query(({ input, ctx }) => {
      return runEffectAsTrpc(getNote(input.id, ctx.user.id));
    }),

  create: createPermissionProtectedProcedure(perms.note.write)
    .input(s(CreateNoteInput))
    .mutation(({ input, ctx }) => {
      const noteData: NewNote = {
        ...input,
        user_id: ctx.user.id,
      };
      return runEffectAsTrpc(createNote(noteData));
    }),

  update: createPermissionProtectedProcedure(perms.note.write)
    .input(s(UpdateNoteInput))
    .mutation(({ input, ctx }) => {
      const { id, ...noteUpdateData } = input;
      return runEffectAsTrpc(updateNote(id, ctx.user.id, noteUpdateData));
    }),
});
