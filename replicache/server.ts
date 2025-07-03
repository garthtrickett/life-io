// File: ./replicache/server.ts
// This file acts as a barrel, exporting the pull and push handlers from their new locations.

import { handlePull, type PullRequest } from "./pull";
import { handlePush } from "./push";

export { handlePull, handlePush };
export type { PullRequest };
