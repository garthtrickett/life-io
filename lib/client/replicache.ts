// FILE: lib/client/replicache.ts

import {
  Replicache,
  type ReadonlyJSONValue,
  type WriteTransaction,
  type JSONValue,
} from "replicache";
import { Either } from "effect";
import { Schema } from "@effect/schema";
import { formatErrorSync } from "@effect/schema/TreeFormatter";
import { BlockSchema, NoteSchema } from "../shared/schemas"; // FIX: Import NoteSchema
import type { BlockUpdate } from "../../types/generated/public/Block";
import { clientLog } from "./logger.client";

// Define the shape of our client-side mutators
type Mutators = {
  createNote: (
    tx: WriteTransaction,
    note: { id: string; title: string; content: string; user_id: string },
  ) => Promise<void>;
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
  name: "life-io-user-id", // Should be unique per user/device
  licenseKey: "l10f93d37bcd041beba8d111a72da0031",
  pushURL: "/replicache/push",
  pullURL: "/replicache/pull",
  mutators: {
    async createNote(tx, { id, title, content, user_id }) {
      const key = `note/${id}`;
      const now = new Date().toISOString();
      // Create a JSON-safe object for Replicache.
      const noteForJSON: ReadonlyJSONValue = {
        id,
        title,
        content,
        user_id,
        created_at: now,
        updated_at: now,
      };
      await tx.set(key, noteForJSON);
    },
    // --- FIX: Refactored updateNote mutator for type safety ---
    async updateNote(tx, { id, title, content }) {
      const key = `note/${id}`;
      // 1. Get the raw JSON value from Replicache
      const noteJSON = (await tx.get(key));

      if (noteJSON === undefined) {
        void clientLog(
          "warn",
          `Note with id ${id} not found for update`,
          undefined,
          "Replicache:updateNote",
        );
        return;
      }

      // 2. Decode the raw value using the schema for validation and type coercion.
      const decodedResult = Schema.decodeUnknownEither(NoteSchema)(noteJSON);

      if (Either.isLeft(decodedResult)) {
        const errorMessage = formatErrorSync(decodedResult.left);
        void clientLog(
          "error",
          `Validation failed for note ${id}: ${errorMessage}`,
          undefined,
          "Replicache:updateNote",
        );
        return;
      }

      // 3. We now have a type-safe `note` object.
      const note = decodedResult.right;

      // 4. Create the updated object for storage. The spread is now safe.
      //    Convert dates back to ISO strings to ensure JSON-compatibility.
      const updatedNoteForJSON: ReadonlyJSONValue = {
        ...note,
        title,
        content,
        created_at: note.created_at.toISOString(),
        updated_at: new Date().toISOString(),
      };

      await tx.set(key, updatedNoteForJSON);
    },
    async updateBlock(tx, { id, ...update }) {
      const key = `block/${id}`;
      const blockJSON = (await tx.get(key)) as JSONValue | undefined;

      if (blockJSON === undefined) {
        void clientLog(
          "warn",
          `Block with id ${id} not found for update`,
          undefined,
          "Replicache:updateBlock",
        );
        return;
      }

      const decodedResult = Schema.decodeUnknownEither(BlockSchema)(blockJSON);

      if (Either.isLeft(decodedResult)) {
        const errorMessage = formatErrorSync(decodedResult.left);
        void clientLog(
          "error",
          `Validation failed for block ${id}: ${errorMessage}`,
          undefined,
          "Replicache:updateBlock",
        );
        return;
      }

      const block = decodedResult.right;

      const updatedBlockForJSON: ReadonlyJSONValue = {
        ...block,
        ...update,
        version: block.version + 1,
        created_at: block.created_at.toISOString(),
        updated_at: new Date().toISOString(),
        fields: block.fields as JSONValue,
      };

      await tx.set(key, updatedBlockForJSON);
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
