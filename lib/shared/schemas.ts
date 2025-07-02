// FILE: lib/shared/schemas.ts
import { Schema } from "@effect/schema";
import type { NoteId, Note } from "../../types/generated/public/Note";
import type { UserId, User } from "../../types/generated/public/User";
import type { BlockId } from "../../types/generated/public/Block";

/**
 * A central place for defining reusable Effect Schemas.
 * This avoids duplication between API-level input validation and
 * core domain logic validation.
 */

const uuidRegex =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i;
/**
 * A base schema representing a UUID string.
 * This is the core validation logic.
 * Its type is `Schema<string, string, never>`.
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

/**
 * A schema for BlockId, using the base UUID validation.
 */
export const BlockIdSchema: Schema.Schema<BlockId, string, never> = (
  UUIDSchemaBase as unknown as Schema.Schema<BlockId, string, never>
).pipe(Schema.annotations({ message: () => "Invalid Block ID format." }));

// --- NEW SCHEMAS ---

/**
 * A schema that can handle both Date objects and ISO date strings,
 * which is common when data comes from a database or JSON serialization.
 */
const DateFromDateOrString = Schema.Union(Schema.Date, Schema.DateFromString);

/**
 * A schema for validating a single note object retrieved from the database.
 * This ensures that the data structure matches the expected `Note` type.
 */
// --- FIX: Disable the 'no-explicit-any' rule for this line. ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const NoteSchema: Schema.Schema<Note, any> = Schema.Struct({
  id: NoteIdSchema,
  user_id: UserIdSchema,
  title: Schema.String,
  content: Schema.String,
  created_at: DateFromDateOrString,
  updated_at: DateFromDateOrString,
});

/**
 * A schema for validating an array of note objects.
 */
export const NotesSchema = Schema.Array(NoteSchema);

/**
 * A schema for validating a single user object retrieved from the database.
 */
// --- FIX: Disable the 'no-explicit-any' rule for this line. ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const UserSchema: Schema.Schema<User, any> = Schema.Struct({
  id: UserIdSchema,
  email: Schema.String.pipe(
    Schema.pattern(
      /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/,
    ),
  ),
  password_hash: Schema.String,
  created_at: DateFromDateOrString,
  permissions: Schema.Union(
    Schema.mutable(Schema.Array(Schema.String)),
    Schema.Null,
  ),
  avatar_url: Schema.Union(Schema.String, Schema.Null),
  email_verified: Schema.Boolean,
});

/**
 * A schema for validating a single block object.
 */
 
export const BlockSchema = Schema.Struct({
  id: Schema.String.pipe(Schema.brand("BlockId")),
  user_id: Schema.String.pipe(Schema.brand("UserId")),
  type: Schema.String,
  content: Schema.String,
  fields: Schema.Any, // <--- FIX #1: Use Schema.Any
  tags: Schema.Array(Schema.String),
  links: Schema.Array(Schema.String),
  file_path: Schema.String,
  parent_id: Schema.Union(
    Schema.String.pipe(Schema.brand("BlockId")),
    Schema.Null,
  ),
  depth: Schema.Number,
  order: Schema.Number,
  transclusions: Schema.Array(Schema.String),
  version: Schema.Number,
  created_at: Schema.DateFromString,
  updated_at: Schema.DateFromString,
});

// 2. Derive the Block type from the schema itself for type safety
export type Block = Schema.Schema.Type<typeof BlockSchema>;
