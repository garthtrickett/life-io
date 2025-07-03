// File: ./elysia/errors.ts
import { Data } from "effect";

export class AuthError extends Data.TaggedError("AuthError")<{
  readonly message: string;
}> {}
export class FileError extends Data.TaggedError("FileError")<{
  readonly message: string;
}> {}
export class S3UploadError extends Data.TaggedError("S3UploadError")<{
  readonly cause: unknown;
}> {}
export class DbUpdateError extends Data.TaggedError("DbUpdateError")<{
  readonly cause: unknown;
}> {}
export class InvalidPullRequestError extends Data.TaggedError(
  "InvalidPullRequestError",
)<{
  readonly message: string;
}> {}
