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
import { BlockSchema, NoteSchema } from "../shared/schemas";
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
      clientLog(
        "info",
        `Executing mutator: createNote for id ${id}`,
        user_id,
        "Replicache:createNote",
      );
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
    async updateNote(tx, { id, title, content }) {
      clientLog(
        "info",
        `Executing mutator: updateNote for id ${id}`,
        undefined,
        "Replicache:updateNote",
      );
      const key = `note/${id}`;
      const noteJSON = await tx.get(key);

      if (noteJSON === undefined) {
        void clientLog(
          "warn",
          `Note with id ${id} not found for update`,
          undefined,
          "Replicache:updateNote",
        );
        return;
      }

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

      const note = decodedResult.right;

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
      clientLog(
        "info",
        `Executing mutator: updateBlock for id ${id}`,
        undefined,
        "Replicache:updateBlock",
      );
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
