// FILE: trpc/routers/note.ts
// UPDATE: This file is now corrected to use safe type assertions after validation.
import { router, publicProcedure } from "../trpc";
import { t } from "elysia";
import { compile } from "@elysiajs/trpc";
import { createNote } from "../../features/notes/createNote";
import { getNotes } from "../../features/notes/getNotes";
import { getNote } from "../../features/notes/getNote";
import { updateNote } from "../../features/notes/updateNote";
import { DbLayer } from "../../db/DbLayer";
import { Effect } from "effect";
import type { Insertable } from "kysely";
import type Note from "../../types/generated/Note";

const HARDCODED_USER_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

// Define input types using `t` for reusability and type safety
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
  // GET /notes -> Fetches all notes for the user
  list: publicProcedure.query(async () => {
    const program = getNotes(HARDCODED_USER_ID).pipe(Effect.provide(DbLayer));
    return Effect.runPromise(program);
  }),

  // GET /notes/:id -> Fetches a single note by ID
  getById: publicProcedure
    .input(compile(GetByIdInput))
    .query(async ({ input }) => {
      // After validation, we can safely assert the type for TypeScript
      const { id } = input as typeof GetByIdInput.static;
      const program = getNote(id, HARDCODED_USER_ID).pipe(
        Effect.provide(DbLayer),
      );
      return Effect.runPromise(program);
    }),

  // POST /notes -> Creates a new note
  create: publicProcedure
    .input(compile(CreateNoteInput))
    .mutation(async ({ input }) => {
      // Assert the type to fix the spread operator error
      const { title, content } = input as typeof CreateNoteInput.static;
      const noteData: Insertable<Note> = {
        title,
        content,
        user_id: HARDCODED_USER_ID,
      };
      const program = createNote(noteData).pipe(Effect.provide(DbLayer));
      return Effect.runPromise(program);
    }),

  // PATCH /notes/:id -> Updates an existing note
  update: publicProcedure
    .input(compile(UpdateNoteInput))
    .mutation(async ({ input }) => {
      // Assert the type to fix destructuring and property access errors
      const { id, ...noteUpdateData } = input as typeof UpdateNoteInput.static;
      const program = updateNote(id, HARDCODED_USER_ID, noteUpdateData).pipe(
        Effect.provide(DbLayer),
      );
      return Effect.runPromise(program);
    }),
});
