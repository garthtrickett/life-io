/**
 * Convert any thrown value into a *real* `Error`.
 *
 * ‣ Works for primitives, plain objects, cross-realm errors, etc.
 * ‣ Copies `message` and `stack` when they are available.
 * ‣ Used by both client and server code so we never need
 *   `instanceof Error` inside a `catch`.
 */
export function toError(err: unknown): Error {
  if (err instanceof Error) return err;

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
