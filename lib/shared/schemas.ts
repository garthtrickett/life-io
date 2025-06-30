// lib/shared/schemas.ts
import { t } from "elysia";

/**
 * A central place for defining reusable TypeBox schemas.
 * This avoids duplication between API-level input validation and
 * core domain logic validation.
 */

export const NoteIdSchema = t.String({
  format: "uuid",
  errorMessage: "Invalid Note ID format.",
});

export const UserIdSchema = t.String({
  format: "uuid",
  errorMessage: "Invalid User ID format.",
});
