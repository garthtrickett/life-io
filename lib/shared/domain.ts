// lib/shared/domain.ts
import { Effect } from "effect";
import { Schema } from "@effect/schema";
// --- FIX: Import the `formatErrorSync` function directly for stricter type compliance ---
import { formatErrorSync } from "@effect/schema/TreeFormatter";
import { NoteIdSchema, UserIdSchema } from "./schemas";
import type { NoteId } from "../../types/generated/public/Note";
import type { UserId } from "../../types/generated/public/User";

/**
 * Validates a string to ensure it's a UUID, returning the Kanel-generated `NoteId` branded type.
 * The function returns an Effect, which will succeed with the branded type or fail with a validation Error.
 */
export const validateNoteId = (value: unknown): Effect.Effect<NoteId, Error> =>
  Schema.decodeUnknown(NoteIdSchema)(value).pipe(
    // --- FIX: Call the function directly, not as a method on an object ---
    Effect.mapError((e) => new Error(formatErrorSync(e))),
  );

/**
 * Validates a string to ensure it's a UUID, returning the Kanel-generated `UserId` branded type.
 * The function returns an Effect, which will succeed with the branded type or fail with a validation Error.
 */
export const validateUserId = (value: unknown): Effect.Effect<UserId, Error> =>
  Schema.decodeUnknown(UserIdSchema)(value).pipe(
    // --- FIX: Call the function directly, not as a method on an object ---
    Effect.mapError((e) => new Error(formatErrorSync(e))),
  );
