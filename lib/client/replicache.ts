// FILE: lib/client/replicache.ts

import {
  Replicache,
  type ReadonlyJSONValue,
  type WriteTransaction,
  type JSONValue,
} from "replicache";
import { Effect } from "effect"; // Added Effect and pipe
import { Schema } from "@effect/schema";
import { formatErrorSync } from "@effect/schema/TreeFormatter";
import { BlockSchema, NoteSchema } from "../shared/schemas";
import type { BlockUpdate } from "../../types/generated/public/Block";
import { clientLog } from "./logger.client";
import { runClientPromise, runClientUnscoped } from "./runtime";
// Added runtime runners
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

export const rep = new Replicache<Mutators>({
  name: "life-io-user-id",
  licenseKey: "l10f93d37bcd041beba8d111a72da0031",
  pushURL: "/replicache/push",
  pullURL: "/replicache/pull",
  mutators: {
    /**
     * Creates a new note. The logic is defined as an Effect and then executed
     * as a promise to conform to Replicache's API.
     */
    async createNote(tx: WriteTransaction, args: NewNote) {
      const createNoteEffect = Effect.gen(function* () {
        yield* clientLog(
          "info",
          `Executing mutator: createNote for id ${args.id}`,
          args.user_id,
          "Replicache:createNote",
        );

        const key = `note/${args.id}`;
        const now = new Date();

        // Validate the note object against the schema before setting it
        const note = yield* Schema.decodeUnknown(NoteSchema)({
          ...args,
          created_at: now,
          updated_at: now,
        }).pipe(
          Effect.mapError(
            (e) => new Error(`Note validation failed: ${formatErrorSync(e)}`),
          ),
        );
        // Convert dates to ISO strings for JSON safety before setting
        const noteForJSON: ReadonlyJSONValue = {
          ...note,
          created_at: note.created_at.toISOString(),
          updated_at: note.updated_at.toISOString(),
        };
        yield* Effect.promise(() => tx.set(key, noteForJSON));
      });

      // Run the effect, catching and logging any errors without re-throwing.
      return runClientPromise(createNoteEffect).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        runClientUnscoped(
          clientLog("error", `Error in createNote mutator: ${message}`),
        );
      });
    },

    /**
     * Updates an existing note.
     * The logic is defined as an Effect.
     */
    async updateNote(tx, { id, title, content }) {
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

        // Decode and validate the existing note
        const note = yield* Schema.decodeUnknown(NoteSchema)(noteJSON).pipe(
          Effect.mapError((e) => new Error(formatErrorSync(e))),
        );

        // Create the updated note object
        const updatedNoteData = {
          ...note,
          title,
          content,
          updated_at: new Date(),
        };

        // Re-validate the final object to ensure consistency
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
        // Convert dates to ISO strings for JSON safety
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

    /**
     * Updates an existing block.
     * The logic is defined as an Effect.
     */
    async updateBlock(tx, { id, ...update }) {
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

        const block = yield* Schema.decodeUnknown(BlockSchema)(blockJSON).pipe(
          Effect.mapError((e) => new Error(formatErrorSync(e))),
        );

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

// Listen for pokes from the server via WebSocket
function setupWebSocket() {
  const ws = new WebSocket(
    `${window.location.protocol === "https:" ? "wss" : "ws"}://${
      window.location.host
    }/ws`,
  );
  ws.onmessage = (event) => {
    if (event.data === "poke") {
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
    // Optional: Implement reconnection logic
    void clientLog(
      "warn",
      "WebSocket closed. Reconnecting in 5s...",
      undefined,
      "Replicache:WS",
    );
    setTimeout(setupWebSocket, 5000);
  };
}

setupWebSocket();
