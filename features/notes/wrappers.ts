import { Effect } from "effect";
import { serverLog } from "../../lib/server/logger.server";
import type { Note } from "../../types/generated/public/Note";

/**
 * Reusable logging wrapper for the getNote feature.
 */
export const withGetNoteLogging =
  <R, E>(noteId: string, userId: string) =>
  <A extends Note>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.tapBoth(self, {
      onFailure: (error) =>
        serverLog(
          "error",
          `[GetNote] Failed for note ${noteId}: ${
            (error as { _tag: string })._tag
          }`,
          userId,
          "GetNote:Failure",
        ),
      onSuccess: (note) =>
        serverLog(
          "info",
          `[GetNote] OK: Successfully fetched note "${note.title}"`,
          userId,
          "GetNote:Success",
        ),
    });

/**
 * Reusable logging wrapper for the getNotes feature.
 * Accepts **ReadonlyArray** so it matches the immutable return type.
 */
export const withGetNotesLogging =
  <R, E>(userId: string) =>
  <A extends ReadonlyArray<Note>>(
    self: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> =>
    Effect.tapBoth(self, {
      onFailure: (error) =>
        serverLog(
          "error",
          `[GetNotes] Failed for user ${userId}: ${
            (error as { _tag: string })._tag
          }`,
          userId,
          "GetNotes:Failure",
        ),
      onSuccess: (notes) =>
        serverLog(
          "info",
          `[GetNotes] OK: Successfully fetched ${notes.length} notes.`,
          userId,
          "GetNotes:Success",
        ),
    });

/**
 * Reusable logging wrapper for the createNote feature.
 */
export const withCreateNoteLogging =
  <R, E>(userId: string, noteTitle: string) =>
  <A extends Note>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.tapBoth(self, {
      onFailure: (error) =>
        serverLog(
          "error",
          `[CreateNote] Failed to create note "${noteTitle}": ${
            (error as { _tag: string })._tag
          }`,
          userId,
          "CreateNote:Failure",
        ),
      onSuccess: (createdNote) =>
        serverLog(
          "info",
          `[CreateNote] OK: Successfully created note "${createdNote.title}" (ID: ${createdNote.id})`,
          userId,
          "CreateNote:Success",
        ),
    });

/**
 * Reusable logging wrapper for the updateNote feature.
 */
export const withUpdateNoteLogging =
  <R, E>(noteId: string, userId: string) =>
  <A extends Note>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.tapBoth(self, {
      onFailure: (error) =>
        serverLog(
          "error",
          `[UpdateNote] Failed to update note ${noteId}: ${
            (error as { _tag: string })._tag
          }`,
          userId,
          "UpdateNote:Failure",
        ),
      onSuccess: (updatedNote) =>
        serverLog(
          "info",
          `[UpdateNote] OK: Successfully updated note "${updatedNote.title}" (ID: ${updatedNote.id})`,
          userId,
          "UpdateNote:Success",
        ),
    });
