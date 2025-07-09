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
          "error", // level
          { noteId, userId, error }, // data
          `[GetNote] Failure: ${(error as { _tag: string })._tag}`, // message
          "GetNote:Failure",
        ),
      onSuccess: (note) =>
        serverLog(
          "info", // level
          { note }, // data
          "[GetNote] OK: Successfully fetched note", // message
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
          "error", // level
          { userId, error }, // data
          `[GetNotes] Failure: ${(error as { _tag: string })._tag}`, // message
          "GetNotes:Failure",
        ),
      onSuccess: (notes) =>
        serverLog(
          "info", // level
          { userId, noteCount: notes.length }, // data
          "[GetNotes] OK: Successfully fetched notes", // message
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
          "error", // level
          { userId, noteTitle, error }, // data
          `[CreateNote] Failure: ${(error as { _tag: string })._tag}`, // message
          "CreateNote:Failure",
        ),
      onSuccess: (createdNote) =>
        serverLog(
          "info", // level
          { note: createdNote }, // data
          "[CreateNote] OK: Successfully created note", // message
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
          "error", // level
          { noteId, userId, error }, // data
          `[UpdateNote] Failure: ${(error as { _tag: string })._tag}`, // message
          "UpdateNote:Failure",
        ),
      onSuccess: (updatedNote) =>
        serverLog(
          "info", // level
          { note: updatedNote }, // data
          "[UpdateNote] OK: Successfully updated note", // message
          "UpdateNote:Success",
        ),
    });
