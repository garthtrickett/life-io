// FILE: lib/shared/toError.ts

export function toError(err: unknown): Error {
  const message =
    err && typeof err === "object" && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err);

  const error = new Error(message);

  if (
    err &&
    typeof err === "object" &&
    "stack" in err &&
    typeof (err as { stack: unknown }).stack === "string"
  ) {
    error.stack = (err as { stack: string }).stack;
  }

  return error;
}
