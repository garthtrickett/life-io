// lib/client/replicache/mutators.ts
import { createNote } from "./createNote";
import { updateNote } from "./updateNote";
import { updateBlock } from "./updateBlock";
import type { Mutators } from "./types";

export const mutators: Mutators = {
  createNote,
  updateNote,
  updateBlock,
};
