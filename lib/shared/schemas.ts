// FILE: lib/shared/schemas.ts

import { Schema } from "@effect/schema";
import type { NoteId, Note } from "../../types/generated/public/Note";
import type { UserId, User } from "../../types/generated/public/User";
import type { BlockId, Block } from "../../types/generated/public/Block";

/**
 * A central place for defining reusable Effect Schemas.
 * This avoids duplication between API-level input validation and
 * core domain logic validation.
 */

/**
 * A schema that accepts a value that is already a `Date` object or a string
 * that can be parsed into a `Date`.
 * This handles cases where the database
 * driver might return a string or a Date object.
 */
const LenientDateSchema = Schema.Union(
  Schema.DateFromSelf,
  Schema.DateFromString,
);

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
/**
 * A schema for validating a single note object retrieved from the database.
 * This ensures that the data structure matches the expected `Note` type.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const NoteSchema: Schema.Schema<Note, any> = Schema.Struct({
  id: NoteIdSchema,
  user_id: UserIdSchema,
  title: Schema.String,
  content: Schema.String,
  created_at: LenientDateSchema,
  updated_at: LenientDateSchema,
  version: Schema.Number, // <-- ADDED: Include the version property
});
/**
 * A schema for validating an array of note objects.
 */
export const NotesSchema = Schema.Array(NoteSchema);
/**
 * A schema for validating a single user object retrieved from the database.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const UserSchema: Schema.Schema<User, any> = Schema.Struct({
  id: UserIdSchema,
  email: Schema.String.pipe(
    Schema.pattern(
      /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/,
    ),
  ),
  password_hash: Schema.String,
  created_at: LenientDateSchema,
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const BlockSchema: Schema.Schema<Block, any> = Schema.Struct({
  id: BlockIdSchema,
  user_id: UserIdSchema,
  note_id: Schema.Union(NoteIdSchema, Schema.Null),
  type: Schema.String,
  content: Schema.String,
  fields: Schema.Any,
  tags: Schema.mutable(Schema.Array(Schema.String)),
  links: Schema.mutable(Schema.Array(Schema.String)),
  file_path: Schema.String,
  parent_id: Schema.Union(BlockIdSchema, Schema.Null),
  depth: Schema.Number,
  order: Schema.Number,
  transclusions: Schema.mutable(Schema.Array(Schema.String)),
  version: Schema.Number,
  created_at: LenientDateSchema,
  updated_at: LenientDateSchema,
});
