// features/notes/wrappers.ts
import { Effect } from "effect";
import { serverLog } from "../../lib/server/logger.server";
import type { Note } from "../../types/generated/public/Note";

/**
 * A reusable logging wrapper for the getNote feature.
 *
 * This is a higher-order function. The outer function takes the log-specific
 * arguments (noteId, userId) and returns the actual pipeable operator.
 */
export const withGetNoteLogging =
  <R, E>(noteId: string, userId: string) =>
  /**
   * This inner function is the pipeable operator. It is generic over the
   * success type `A`, which is constrained to `Note` to ensure `note.title` exists.
   * When used in a `pipe`, `self` will be the effect passed from the previous step.
   */
  <A extends Note>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    // We now use the data-first version of `tapBoth`, providing `self` directly.
    // This allows TypeScript to correctly infer the types for `note` and `error`.
    Effect.tapBoth(self, {
      onFailure: (
        error, // `error` is correctly inferred as type `E`.
      ) =>
        serverLog(
          "error",
          `[GetNote] Failed for note ${noteId}: ${(error as { _tag: string })._tag}`,
          userId,
          "GetNote:Failure",
        ),
      onSuccess: (
        note, // `note` is correctly inferred as type `A`.
      ) =>
        serverLog(
          "info",
          `[GetNote] OK: Successfully fetched note "${note.title}"`,
          userId,
          "GetNote:Success",
        ),
    });
