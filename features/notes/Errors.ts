// features/notes/Errors.ts
import { Data } from "effect";

/**
 * Error for when a requested note is not found for the given user.
 */
export class NoteNotFoundError extends Data.TaggedError("NoteNotFoundError")<{
  noteId: string;
  userId: string;
}> {}

/**
 * A generic database error for note operations.
 */
export class NoteDatabaseError extends Data.TaggedError("NoteDatabaseError")<{
  cause: unknown;
}> {}
