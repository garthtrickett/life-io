import { Effect, Context, Layer } from "effect";

// -----------------------------------------------------------------
// --- Setup & Mocks: Self-Contained Dependencies for Examples    ---
// -----------------------------------------------------------------

// --- Core Types & Custom Errors ---
export type Id = string;
export interface Note {
  id: Id;
  userId: Id;
  content: string;
}
export type NewNote = Omit<Note, "id">;
export type Patch = Partial<Omit<Note, "id" | "userId">>;
export type DbRow = Note;

export class ForbiddenError extends Error {
  readonly _tag = "ForbiddenError";
  constructor() {
    super("Access denied");
  }
}
export class NoteCreationError extends Error {
  readonly _tag = "NoteCreationError";
  constructor(message: string = "Failed to create note") {
    super(message);
  }
}

// --- Mock Services & Dependencies ---
const Schema = {
  decode: (_schema: any) => (u: unknown) => {
    const note = u as NewNote;
    if (
      note &&
      typeof note.userId === "string" &&
      typeof note.content === "string"
    ) {
      return Effect.succeed(note);
    }
    return Effect.fail(new NoteCreationError("Invalid note structure"));
  },
};
const NoteSchema = { name: "NoteSchema" };

const Db = {
  note: {
    insert: (input: NewNote) =>
      Effect.succeed({ id: `note_${Math.random()}`, ...input }),
    update: (id: Id, p: Patch) =>
      Effect.succeed({ id, userId: "user_1", content: p.content || "" }),
    find: (id: Id) =>
      Effect.succeed({ id, userId: "user_1", content: "A sample note." }),
    listByUser: (uid: Id) =>
      Effect.succeed([{ id: "note_1", userId: uid, content: "User note 1" }]),
  },
  task: {
    listByUser: (uid: Id) =>
      Effect.succeed([{ id: "task_1", userId: uid, title: "User task 1" }]),
  },
};

const Analytics = {
  userStats: (uid: Id) =>
    Effect.succeed({ notesCreated: 5, tasksCompleted: 10 }),
};

const clientLog = (level: string, message: string) =>
  Effect.sync(() => console.log(`[${level.toUpperCase()}] ${message}`));

const pokeReplicache = (userId: Id) =>
  Effect.sync(() => console.log(`Poking Replicache for user ${userId}`));

const app = {
  post: (
    route: string,
    handler: (req: { body: unknown }) => Promise<unknown>,
  ) => {
    console.log(`Registered POST route: ${route}`);
    handler({
      body: { userId: "user_foo", content: "Hello from mock request" },
    })
      .then((res) => console.log("Mock request succeeded:", res))
      .catch((err) => console.error("Mock request failed:", err));
  },
};

// -----------------------------------------------------------------
// --- Self-Contained Examples                                    ---
// -----------------------------------------------------------------

// 1. Write the core logic in plain functions first.
export const validate = (u: unknown) => Schema.decode(NoteSchema)(u);
export const insert = (input: NewNote) => Db.note.insert(input);
export const update = (id: Id, p: Patch) => Db.note.update(id, p);
export const toResponse = (row: DbRow) => ({ ...row });

// 2. Express the “story” once, with Effect.gen.
export const createNote = (raw: unknown) =>
  Effect.gen(function* (_) {
    const validated = yield* _(validate(raw));
    const row = yield* _(insert(validated));
    yield* _(pokeReplicache(row.userId));
    return toResponse(row);
  });

// 3. Keep cross-cutting extras as wrappers, not in-line taps.
export const withLogging = <R, E, A>(
  tag: string,
): ((self: Effect.Effect<R, E, A>) => Effect.Effect<R, E, A>) =>
  Effect.tapBoth({
    onFailure: (e) => clientLog("error", `${tag} – ${String(e)}`),
    onSuccess: () => clientLog("debug", `${tag} – OK`),
  });

export const createNoteLogged = (raw: unknown) =>
  createNote(raw).pipe(withLogging("createNote"));

// 4. Surface early-exit branches with helpers—not nested ifs.
const ensureOwner = (userId: Id, noteId: Id) =>
  Effect.flatMap(Db.note.find(noteId), (row) =>
    row.userId === userId
      ? Effect.succeed(row)
      : Effect.fail(new ForbiddenError()),
  );

// 5. Combine parallel work with Effect.all, not nested zips.
const getDashboardData = (uid: Id) =>
  Effect.all({
    notes: Db.note.listByUser(uid),
    tasks: Db.task.listByUser(uid),
    stats: Analytics.userStats(uid),
  });

// 6. Treat the HTTP / RPC layer as a thin wrapper.
const handleCreateNoteRequest = (req: { body: unknown }) =>
  createNoteLogged(req.body).pipe(
    Effect.match({
      onSuccess: (note) => ({ status: 201, body: note }),
      onFailure: (error) => {
        if (error instanceof NoteCreationError) {
          return { status: 400, body: { message: error.message } };
        }
        return { status: 500, body: { message: "Internal server error" } };
      },
    }),
  );

app.post("/api/notes", (req) =>
  Effect.runPromise(handleCreateNoteRequest(req)),
);

// 7. Put background “fire-and-forget” work on a queue.
const createNoteAndFork = (raw: unknown) =>
  Effect.gen(function* (_) {
    const validated = yield* _(validate(raw));
    const row = yield* _(insert(validated));
    yield* _(Effect.fork(pokeReplicache(row.userId)));
    return toResponse(row);
  });

// 9. Codify the pattern with a lint rule or template.
/*
  This tip is about project configuration. An example rule in a
  linting config file (e.g., eslintrc.js) might look like:

  "effect-ts/max-pipe-depth": ["warn", { "max": 2 }]

  This prevents deep nesting and encourages the patterns above.
*/
