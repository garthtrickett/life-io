// FILE: trpc/routers/note.ts
import { router, publicProcedure } from "../trpc";
import { t } from "elysia";
import { compile } from "@elysiajs/trpc";
import { createNote } from "../../features/notes/createNote";
import { DbLayer } from "../../db/DbLayer";
import { Effect } from "effect";
import type { Insertable } from "kysely"; // FIX: Import Insertable
import type Note from "../../types/generated/Note"; // FIX: Import the Note type

export const noteRouter = router({
  createNote: publicProcedure
    .input(
      compile(
        t.Object({
          user_id: t.String({ format: "uuid" }),
          title: t.String({ minLength: 1 }),
          content: t.String(),
        }),
      ),
    )
    .mutation(async ({ input }) => {
      // FIX: Use a type assertion to inform TypeScript about the shape of 'input'.
      // We can be confident about this because Elysia's `compile` has already
      // performed runtime validation. If the input was invalid, this code
      // would not be reached.
      const program = createNote(input as Insertable<Note>).pipe(
        Effect.provide(DbLayer),
      );

      return Effect.runPromise(program);
    }),
});
