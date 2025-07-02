// features/auth/schemas.ts
import { Schema } from "@effect/schema";
import { s } from "../../trpc/validator";

// Define a reusable email schema filter, as it's not a built-in one.
const email = () =>
  Schema.pattern(
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/,
    { message: () => "Invalid email address" },
  );

// --- Input Schemas defined with Effect Schema ---
export const SignupInput = Schema.Struct({
  email: Schema.String.pipe(email()),
  password: Schema.String.pipe(Schema.minLength(8)),
});

export const LoginInput = Schema.Struct({
  email: Schema.String.pipe(email()),
  password: Schema.String,
});

export const RequestPasswordResetInput = Schema.Struct({
  email: Schema.String.pipe(email()),
});

export const ResetPasswordInput = Schema.Struct({
  token: Schema.String,
  password: Schema.String.pipe(Schema.minLength(8)),
});

export const VerifyEmailInput = Schema.Struct({
  token: Schema.String,
});

export const ChangePasswordInput = Schema.Struct({
  oldPassword: Schema.String,
  newPassword: Schema.String.pipe(Schema.minLength(8)),
});

// Helper to use schemas with tRPC input validation
export const sSignupInput = s(SignupInput);
export const sLoginInput = s(LoginInput);
export const sRequestPasswordResetInput = s(RequestPasswordResetInput);
export const sResetPasswordInput = s(ResetPasswordInput);
export const sVerifyEmailInput = s(VerifyEmailInput);
export const sChangePasswordInput = s(ChangePasswordInput);
