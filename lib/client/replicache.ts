// FILE: lib/client/replicache.ts

import {
  Replicache,
  type ReadonlyJSONValue,
  type WriteTransaction,
  type JSONValue,
} from "replicache";
import { Effect } from "effect";
import { Schema } from "@effect/schema";
import { formatErrorSync } from "@effect/schema/TreeFormatter";
import { BlockSchema, NoteSchema } from "../shared/schemas";
import type { BlockUpdate } from "../../types/generated/public/Block";
import { clientLog } from "./logger.client";
import { runClientPromise, runClientUnscoped } from "./runtime";
import type { NewNote } from "../../types/generated/public/Note";

// Define the shape of our client-side mutators
type Mutators = {
  createNote: (tx: WriteTransaction, note: NewNote) => Promise<void>;
  updateNote: (
    tx: WriteTransaction,
    update: { id: string; title: string; content: string },
  ) => Promise<void>;
  updateBlock: (
    tx: WriteTransaction,
    update: BlockUpdate & { id: string },
  ) => Promise<void>;
};

// --- START OF FIX: Create a mutable holder for the Replicache instance ---
export let rep: Replicache<Mutators> | null = null;
// --- END OF FIX ---

// --- START OF FIX: Wrap instantiation in a function ---
export const initReplicache = (
  userId: string,
): Effect.Effect<Replicache<Mutators>> =>
  Effect.gen(function* () {
    // If an instance already exists, close it first.
    if (rep) {
      yield* clientLog(
        "warn",
        "Closing existing Replicache instance before creating a new one.",
      );
      yield* Effect.promise(() => rep!.close());
    }

    const newRep = new Replicache<Mutators>({
      // The name is now unique to the user
      name: `life-io-user-${userId}`,
      licenseKey: "l10f93d37bcd041beba8d111a72da0031",
      pushURL: "/api/replicache/push",
      pullURL: "/api/replicache/pull",
      mutators: {
        async createNote(tx: WriteTransaction, args: NewNote) {
          /* ... mutator logic remains the same ... */
          const createNoteEffect = Effect.gen(function* () {
            yield* clientLog(
              "info",
              `Executing mutator: createNote for id ${args.id}`,
              args.user_id,
              "Replicache:createNote",
            );
            const key = `note/${args.id}`;
            const now = new Date();
            const note = yield* Schema.decodeUnknown(NoteSchema)({
              ...args,
              created_at: now,
              updated_at: now,
            }).pipe(
              Effect.mapError(
                (e) =>
                  new Error(`Note validation failed: ${formatErrorSync(e)}`),
              ),
            );
            const noteForJSON: ReadonlyJSONValue = {
              ...note,
              created_at: note.created_at.toISOString(),
              updated_at: note.updated_at.toISOString(),
            };
            yield* Effect.promise(() => tx.set(key, noteForJSON));
          });
          return runClientPromise(createNoteEffect).catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            runClientUnscoped(
              clientLog("error", `Error in createNote mutator: ${message}`),
            );
          });
        },
        async updateNote(tx, { id, title, content }) {
          /* ... mutator logic remains the same ... */
          const updateNoteEffect = Effect.gen(function* () {
            yield* clientLog(
              "info",
              `Executing mutator: updateNote for id ${id}`,
              undefined,
              "Replicache:updateNote",
            );
            const key = `note/${id}`;
            const noteJSON = yield* Effect.promise(() => tx.get(key));
            if (noteJSON === undefined) {
              return yield* Effect.fail(
                new Error(`Note with id ${id} not found for update.`),
              );
            }
            const note = yield* Schema.decodeUnknown(NoteSchema)(noteJSON).pipe(
              Effect.mapError((e) => new Error(formatErrorSync(e))),
            );
            const updatedNoteData = {
              ...note,
              title,
              content,
              updated_at: new Date(),
            };
            const validatedUpdate = yield* Schema.decodeUnknown(NoteSchema)(
              updatedNoteData,
            ).pipe(
              Effect.mapError(
                (e) =>
                  new Error(
                    `Updated note validation failed: ${formatErrorSync(e)}`,
                  ),
              ),
            );
            const updatedNoteForJSON: ReadonlyJSONValue = {
              ...validatedUpdate,
              created_at: validatedUpdate.created_at.toISOString(),
              updated_at: validatedUpdate.updated_at.toISOString(),
            };
            yield* Effect.promise(() => tx.set(key, updatedNoteForJSON));
          });
          return runClientPromise(updateNoteEffect).catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            runClientUnscoped(
              clientLog("error", `Error in updateNote mutator: ${message}`),
            );
          });
        },
        async updateBlock(tx, { id, ...update }) {
          /* ... mutator logic remains the same ... */
          const updateBlockEffect = Effect.gen(function* () {
            yield* clientLog(
              "info",
              `Executing mutator: updateBlock for id ${id}`,
              undefined,
              "Replicache:updateBlock",
            );
            const key = `block/${id}`;
            const blockJSON = (yield* Effect.promise(() => tx.get(key))) as
              | JSONValue
              | undefined;
            if (blockJSON === undefined) {
              return yield* Effect.fail(
                new Error(`Block with id ${id} not found for update`),
              );
            }
            const block = yield* Schema.decodeUnknown(BlockSchema)(
              blockJSON,
            ).pipe(Effect.mapError((e) => new Error(formatErrorSync(e))));
            const updatedBlockData = {
              ...block,
              ...update,
              version: block.version + 1,
              updated_at: new Date(),
            };
            const validatedUpdate = yield* Schema.decodeUnknown(BlockSchema)(
              updatedBlockData,
            ).pipe(
              Effect.mapError(
                (e) =>
                  new Error(
                    `Updated block validation failed: ${formatErrorSync(e)}`,
                  ),
              ),
            );
            const updatedBlockForJSON: ReadonlyJSONValue = {
              ...validatedUpdate,
              created_at: validatedUpdate.created_at.toISOString(),
              updated_at: validatedUpdate.updated_at.toISOString(),
              fields: validatedUpdate.fields as JSONValue,
            };
            yield* Effect.promise(() => tx.set(key, updatedBlockForJSON));
          });
          return runClientPromise(updateBlockEffect).catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            runClientUnscoped(
              clientLog("error", `Error in updateBlock mutator: ${message}`),
            );
          });
        },
      },
    });

    // Assign the new instance to the mutable export
    rep = newRep;
    setupWebSocket();
    yield* clientLog("info", `Replicache initialized for user: ${userId}`);
    return newRep;
  });
// --- END OF FIX ---

// Listen for pokes from the server via WebSocket
function setupWebSocket() {
  const ws = new WebSocket(
    `${window.location.protocol === "https:" ? "wss" : "ws"}://${
      window.location.host
    }/ws`,
  );
  ws.onmessage = (event) => {
    if (event.data === "poke" && rep) {
      // Check if rep exists
      void clientLog(
        "info",
        "Poke received, pulling changes...",
        undefined,
        "Replicache:WS",
      );
      void rep.pull();
    }
  };
  ws.onclose = () => {
    void clientLog(
      "warn",
      "WebSocket closed. It will be reopened on next login.",
      undefined,
      "Replicache:WS",
    );
  };
}
