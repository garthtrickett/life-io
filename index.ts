// FILE: index.ts
// --- Fix: Added Elysia body validation to ensure `body` has the correct type ---
import { Elysia, t } from "elysia";
import { Effect, pipe } from "effect";
import { DbLayer } from "./db/DbLayer";
import { createNote } from "./features/notes/createNote";

const app = new Elysia();

// By adding a schema for the body, Elysia guarantees that `body` is not
// `unknown` but is an object matching this shape. This fixes the type errors.
app.post(
  "/note",
  async ({ body }) =>
    pipe(createNote(body), Effect.provide(DbLayer), Effect.runPromise),
  {
    body: t.Object({
      user_id: t.String(),
      title: t.String(),
      content: t.String(),
    }),
  },
);

app.listen(42069, () =>
  console.log("🦊  Elysia listening on http://localhost:42069"),
);
