// lib/shared/domain.ts
import { Effect } from "effect";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { type TString } from "@sinclair/typebox";
import { NoteIdSchema, UserIdSchema } from "./schemas";
import type { NoteId } from "../../types/generated/public/Note";
import type { UserId } from "../../types/generated/public/User";

// --- Compiled Checkers for performance ---
const NoteIdChecker = TypeCompiler.Compile(NoteIdSchema);
const UserIdChecker = TypeCompiler.Compile(UserIdSchema);

// --- Validation Functions ---

/**
 * Helper to create a generic validation effect from a TypeBox checker.
 */
const makeValidator = <T extends string>( // <-- FIX: The generic constraint is relaxed from `Brand.Brand<any>` to just `string`.
  checker: ReturnType<typeof TypeCompiler.Compile<TString>>,
) => {
  return (value: unknown): Effect.Effect<T, Error> => {
    if (checker.Check(value)) {
      // The cast to `T` is safe because we've successfully validated the shape.
      return Effect.succeed(value as T);
    }
    // Extract a more specific error message if available
    const error = checker.Errors(value).First();
    return Effect.fail(new Error(error?.message ?? "Validation failed"));
  };
};

/**
 * Validates a string to ensure it's a UUID, returning the Kanel-generated `NoteId` branded type.
 */
export const validateNoteId = makeValidator<NoteId>(NoteIdChecker);

/**
 * Validates a string to ensure it's a UUID, returning the Kanel-generated `UserId` branded type.
 */
export const validateUserId = makeValidator<UserId>(UserIdChecker);
