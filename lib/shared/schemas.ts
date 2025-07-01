// lib/shared/schemas.ts
import { Schema } from "@effect/schema";
import type { NoteId } from "../../types/generated/public/Note";
import type { UserId } from "../../types/generated/public/User";

/**
 * A central place for defining reusable Effect Schemas.
 * This avoids duplication between API-level input validation and
 * core domain logic validation.
 */

const uuidRegex =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i;

/**
 * A base schema representing a UUID string.
 * This is the core validation logic. Its type is `Schema<string, string, never>`.
 */
const UUIDSchemaBase = Schema.String.pipe(
  Schema.pattern(uuidRegex, {
    identifier: "UUID",
    description: "a Universally Unique Identifier",
  }),
);

/**
 * A schema for NoteId. It uses the base UUID validation and then
 * is safely cast to the specific branded type from Kanel.
 * The cast is now fully specified: the input type `I` remains `string`.
 */
export const NoteIdSchema: Schema.Schema<NoteId, string, never> = (
  UUIDSchemaBase as unknown as Schema.Schema<NoteId, string, never>
).pipe(Schema.annotations({ message: () => "Invalid Note ID format." }));

/**
 * A schema for UserId. It also uses the base UUID validation and
 * is cast to its specific branded type using the same explicit pattern.
 */
export const UserIdSchema: Schema.Schema<UserId, string, never> = (
  UUIDSchemaBase as unknown as Schema.Schema<UserId, string, never>
).pipe(Schema.annotations({ message: () => "Invalid User ID format." }));
