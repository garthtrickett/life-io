import {
  Replicache,
  type WriteTransaction,
  type JSONValue,
  type ReadonlyJSONValue,
} from "replicache";
import { Either } from "effect";
import { Schema } from "@effect/schema";
import { formatErrorSync } from "@effect/schema/TreeFormatter";
import { BlockSchema } from "../shared/schemas";
import type { BlockUpdate } from "../../types/generated/public/Block";
import { clientLog } from "./logger.client";

// Define the shape of our client-side mutators
type Mutators = {
  updateBlock: (
    tx: WriteTransaction,
    update: BlockUpdate & { id: string },
  ) => Promise<void>;
  // ... other mutators like createBlock, deleteBlock
};

export const rep = new Replicache<Mutators>({
  name: "life-io-user-id", // Should be unique per user/device
  licenseKey: "l_5a79f57f443b45a4b79b9a6741491e84", // Replace with your actual license key
  pushURL: "/replicache/push",
  pullURL: "/replicache/pull",
  mutators: {
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

      // --- THE FIX IS HERE ---
      // Use `decodeUnknownEither` to get an Either<ParseError, Block> result directly.
      const decodedResult = Schema.decodeUnknownEither(BlockSchema)(blockJSON);

      // This logic is now correct because `decodedResult` is an `Either`.
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

      // `decodedResult.right` now correctly exists and is type-safe.
      const block = decodedResult.right;

      // Create a fully JSON-serializable object before setting.
      const updatedBlockForJSON: ReadonlyJSONValue = {
        ...block,
        ...update,
        version: block.version + 1,
        created_at: block.created_at.toISOString(),
        updated_at: new Date().toISOString(),
        // If you know `fields` is JSON-serialisable, cast just that property:
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
