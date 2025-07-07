// lib/client/replicache/types.ts
import type { WriteTransaction } from "replicache";
import type { NewNote } from "../../../types/generated/public/Note";
import type { BlockUpdate } from "../../../types/generated/public/Block";

/**
 * Defines the shape of the mutators that the client-side Replicache instance will use.
 * Each property is a function that performs a specific write operation.
 */
export type Mutators = {
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
