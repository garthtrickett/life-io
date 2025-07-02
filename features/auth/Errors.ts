// FILE: features/auth/Errors.ts
import { Data } from "effect";
import type { ParseError } from "@effect/schema/ParseResult";

/**
 * A generic database error for authentication operations.
 */
export class AuthDatabaseError extends Data.TaggedError("AuthDatabaseError")<{
  readonly cause: unknown;
}> {}

/**
 * Error for when hashing a password fails.
 */
export class PasswordHashingError extends Data.TaggedError(
  "PasswordHashingError",
)<{
  readonly cause: unknown;
}> {}

/**
 * Error for when an email is already in use during signup.
 */
export class EmailInUseError extends Data.TaggedError("EmailInUseError")<{
  readonly email: string;
  readonly cause: unknown;
}> {}

/**
 * Error for when login credentials (email/password) are incorrect.
 */
export class InvalidCredentialsError extends Data.TaggedError(
  "InvalidCredentialsError",
) {}

/**
 * Error for when a user tries to log in but their email is not verified.
 */
export class EmailNotVerifiedError extends Data.TaggedError(
  "EmailNotVerifiedError",
) {}

/**
 * Error for when creating a token (verification, password reset) fails.
 */
export class TokenCreationError extends Data.TaggedError("TokenCreationError")<{
  readonly cause: unknown;
}> {}

/**
 * Error for when a provided token is invalid or expired.
 */
export class TokenInvalidError extends Data.TaggedError("TokenInvalidError") {}

/**
 * Error for when sending an email fails.
 */
export class EmailSendError extends Data.TaggedError("EmailSendError")<{
  readonly cause: unknown;
}> {}

/**
 * Error for when auth-related data from the DB fails schema validation.
 */
export class AuthValidationError extends Data.TaggedError(
  "AuthValidationError",
)<{
  readonly cause: ParseError;
}> {}
