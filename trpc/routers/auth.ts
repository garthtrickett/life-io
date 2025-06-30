// File: trpc/routers/auth.ts
import { router, publicProcedure, loggedInProcedure } from "../trpc";
import { t } from "elysia";
import { compile } from "@elysiajs/trpc";
import { Effect } from "effect";
import {
  argon2id,
  createSessionEffect,
  deleteSessionEffect,
} from "../../lib/server/auth";
import { TRPCError } from "@trpc/server";
import type { NewUser } from "../../types/generated/public/User";
import { perms } from "../../lib/shared/permissions";
import { runServerPromise } from "../../lib/server/runtime";
import { serverLog } from "../../lib/server/logger.server";
import { generateId } from "../../lib/server/utils";
import { createDate, isWithinExpirationDate } from "oslo";
import { TimeSpan } from "oslo";
import type { EmailVerificationTokenId } from "../../types/generated/public/EmailVerificationToken";
import type { PasswordResetTokenId } from "../../types/generated/public/PasswordResetToken";
import { sendEmail } from "../../lib/server/email";

// --- Input Schemas ---

const SignupInput = t.Object({
  email: t.String({ format: "email" }),
  password: t.String({ minLength: 8 }),
});

const LoginInput = t.Object({
  email: t.String({ format: "email" }),
  password: t.String(),
});

const RequestPasswordResetInput = t.Object({
  email: t.String({ format: "email" }),
});

const ResetPasswordInput = t.Object({
  token: t.String(),
  password: t.String({ minLength: 8 }),
});

const VerifyEmailInput = t.Object({
  token: t.String(),
});

// --- ADD THIS NEW SCHEMA ---
const ChangePasswordInput = t.Object({
  oldPassword: t.String(),
  newPassword: t.String({ minLength: 8 }),
});

export const authRouter = router({
  // --- SIGNUP (existing) ---
  signup: publicProcedure
    .input(compile(SignupInput))
    .mutation(({ input, ctx }) => {
      const { email, password } = input as typeof SignupInput.static;

      const program = Effect.gen(function* () {
        yield* serverLog(
          "info",
          `Attempting to sign up user: ${email}`,
          undefined,
          "auth:signup",
        );

        const passwordHash = yield* Effect.tryPromise({
          try: () => argon2id.hash(password),
          catch: () =>
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Could not hash password",
            }),
        });

        const user = yield* Effect.tryPromise({
          try: () =>
            ctx.db
              .insertInto("user")
              .values({
                email: email.toLowerCase(),
                password_hash: passwordHash,
                permissions: [perms.note.read, perms.note.write],
                email_verified: false,
              } as NewUser)
              .returningAll()
              .executeTakeFirstOrThrow(),
          catch: () =>
            new TRPCError({
              code: "CONFLICT",
              message: "An account with this email already exists.",
            }),
        });

        yield* serverLog(
          "info",
          `User created successfully: ${user.id}`,
          user.id,
          "auth:signup",
        );

        const verificationToken = generateId(40);
        yield* Effect.tryPromise({
          try: () =>
            ctx.db
              .insertInto("email_verification_token")
              .values({
                id: verificationToken as EmailVerificationTokenId,
                user_id: user.id,
                email: user.email,
                expires_at: createDate(new TimeSpan(2, "h")),
              })
              .execute(),
          catch: () =>
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Could not create verification token.",
            }),
        });

        const verificationLink = `http://localhost:5173/verify-email/${verificationToken}`;
        yield* sendEmail(
          user.email,
          "Verify Your Email Address",
          `<h1>Welcome!</h1><p>Click the link to verify your email: <a href="${verificationLink}">${verificationLink}</a></p>`,
        );

        yield* serverLog(
          "info",
          `Verification email sent for ${user.email}`,
          user.id,
          "auth:signup",
        );

        return { success: true, email: user.email };
      });

      return runServerPromise(program);
    }),

  // --- LOGIN (existing) ---
  login: publicProcedure
    .input(compile(LoginInput))
    .mutation(({ input, ctx }) => {
      const { email, password } = input as typeof LoginInput.static;

      const program = Effect.gen(function* () {
        yield* serverLog(
          "info",
          `Login attempt for user: ${email}`,
          undefined,
          "auth:login",
        );

        const user = yield* Effect.tryPromise({
          try: () =>
            ctx.db
              .selectFrom("user")
              .selectAll()
              .where("email", "=", email.toLowerCase())
              .executeTakeFirst(),
          catch: (e) =>
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: String(e),
            }),
        });

        if (!user || !user.password_hash) {
          return yield* Effect.fail(
            new TRPCError({
              code: "BAD_REQUEST",
              message: "Invalid email or password.",
            }),
          );
        }

        if (!user.email_verified) {
          yield* serverLog(
            "warn",
            `Login failed: Email not verified for ${user.id}`,
            user.id,
            "auth:login",
          );
          return yield* Effect.fail(
            new TRPCError({
              code: "FORBIDDEN",
              message: "Please verify your email before logging in.",
            }),
          );
        }

        const validPassword = yield* Effect.tryPromise({
          try: () => argon2id.verify(user.password_hash, password),
          catch: (e) =>
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: String(e),
            }),
        });

        if (!validPassword) {
          return yield* Effect.fail(
            new TRPCError({
              code: "BAD_REQUEST",
              message: "Invalid email or password.",
            }),
          );
        }

        yield* serverLog(
          "info",
          `Login successful for user: ${user.id}`,
          user.id,
          "auth:login",
        );
        const sessionId = yield* createSessionEffect(user.id);
        return { sessionId, user };
      });

      return runServerPromise(program);
    }),
  // --- ADD THIS NEW MUTATION ---
  changePassword: loggedInProcedure
    .input(compile(ChangePasswordInput))
    .mutation(({ input, ctx }) => {
      const { oldPassword, newPassword } =
        input as typeof ChangePasswordInput.static;

      const program = Effect.gen(function* () {
        const userId = ctx.user.id;
        yield* serverLog(
          "info",
          `Password change attempt for user: ${userId}`,
          userId,
          "auth:changePassword",
        );

        const user = yield* Effect.tryPromise({
          try: () =>
            ctx.db
              .selectFrom("user")
              .select("password_hash")
              .where("id", "=", userId)
              .executeTakeFirstOrThrow(),
          catch: () =>
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Could not retrieve user data.",
            }),
        });

        const validOldPassword = yield* Effect.tryPromise({
          try: () => argon2id.verify(user.password_hash, oldPassword),
          catch: () =>
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Password verification failed.",
            }),
        });

        if (!validOldPassword) {
          yield* serverLog(
            "warn",
            `Incorrect old password provided for user: ${userId}`,
            userId,
            "auth:changePassword",
          );
          return yield* Effect.fail(
            new TRPCError({
              code: "BAD_REQUEST",
              message: "Incorrect old password provided.",
            }),
          );
        }

        const newPasswordHash = yield* Effect.tryPromise({
          try: () => argon2id.hash(newPassword),
          catch: () =>
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Could not hash new password.",
            }),
        });

        yield* Effect.tryPromise({
          try: () =>
            ctx.db
              .updateTable("user")
              .set({ password_hash: newPasswordHash })
              .where("id", "=", userId)
              .execute(),
          catch: () =>
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Could not update password.",
            }),
        });

        yield* serverLog(
          "info",
          `Password changed successfully for user: ${userId}`,
          userId,
          "auth:changePassword",
        );

        return { success: true };
      });

      return runServerPromise(program);
    }),

  // --- LOGOUT (existing) ---
  logout: loggedInProcedure.mutation(({ ctx }) => {
    const program = Effect.gen(function* () {
      yield* serverLog(
        "info",
        `User initiated logout.`,
        ctx.user.id,
        "auth:logout",
      );
      yield* deleteSessionEffect(ctx.session.id);
      return { success: true };
    });
    return runServerPromise(program);
  }),

  // --- ME (existing) ---
  me: publicProcedure.query(({ ctx }) => {
    return ctx.user;
  }),

  // --- REQUEST PASSWORD RESET (existing) ---
  requestPasswordReset: publicProcedure
    .input(compile(RequestPasswordResetInput))
    .mutation(({ input, ctx }) => {
      const { email } = input as typeof RequestPasswordResetInput.static;
      const program = Effect.gen(function* () {
        yield* serverLog(
          "info",
          `Password reset requested for ${email}`,
          undefined,
          "auth:requestPasswordReset",
        );
        const user = yield* Effect.tryPromise({
          try: () =>
            ctx.db
              .selectFrom("user")
              .selectAll()
              .where("email", "=", email.toLowerCase())
              .executeTakeFirst(),
          catch: () =>
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Database error",
            }),
        });

        if (user) {
          const tokenId = generateId(40);
          yield* Effect.tryPromise({
            try: () =>
              ctx.db
                .deleteFrom("password_reset_token")
                .where("user_id", "=", user.id)
                .execute(),
            catch: () =>
              new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "DB Error",
              }),
          });
          yield* Effect.tryPromise({
            try: () =>
              ctx.db
                .insertInto("password_reset_token")
                .values({
                  id: tokenId as PasswordResetTokenId,
                  user_id: user.id,
                  expires_at: createDate(new TimeSpan(2, "h")),
                })
                .execute(),
            catch: () =>
              new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Could not create token.",
              }),
          });

          const resetLink = `http://localhost:5173/reset-password/${tokenId}`;
          yield* sendEmail(
            user.email,
            "Reset Your Password",
            `<h1>Password Reset</h1><p>Click the link to reset your password: <a href="${resetLink}">${resetLink}</a></p>`,
          );

          yield* serverLog(
            "info",
            `Password reset token created and email sent for ${user.email}`,
            user.id,
            "auth:requestPasswordReset",
          );
        } else {
          yield* serverLog(
            "info",
            `Password reset requested for non-existent user: ${email}`,
            undefined,
            "auth:requestPasswordReset",
          );
        }
        return { success: true };
      });
      return runServerPromise(program);
    }),

  // --- RESET PASSWORD (existing) ---
  resetPassword: publicProcedure
    .input(compile(ResetPasswordInput))
    .mutation(({ input, ctx }) => {
      const { token, password } = input as typeof ResetPasswordInput.static;
      const program = Effect.gen(function* () {
        const storedToken = yield* Effect.tryPromise({
          try: () =>
            ctx.db
              .selectFrom("password_reset_token")
              .selectAll()
              .where("id", "=", token as PasswordResetTokenId)
              .executeTakeFirst(),
          catch: () =>
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "DB Error",
            }),
        });

        if (storedToken) {
          yield* Effect.tryPromise({
            try: () =>
              ctx.db
                .deleteFrom("password_reset_token")
                .where("id", "=", token as PasswordResetTokenId)
                .execute(),
            catch: () =>
              new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "DB Error",
              }),
          });
        }

        if (!storedToken || !isWithinExpirationDate(storedToken.expires_at)) {
          return yield* Effect.fail(
            new TRPCError({
              code: "BAD_REQUEST",
              message: "Token is invalid or has expired.",
            }),
          );
        }

        const passwordHash = yield* Effect.tryPromise({
          try: () => argon2id.hash(password),
          catch: () =>
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Could not hash password",
            }),
        });

        yield* Effect.tryPromise({
          try: () =>
            ctx.db
              .updateTable("user")
              .set({ password_hash: passwordHash })
              .where("id", "=", storedToken.user_id)
              .execute(),
          catch: () =>
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Could not update password.",
            }),
        });

        yield* serverLog(
          "info",
          `Password reset successfully for user ${storedToken.user_id}`,
          storedToken.user_id,
          "auth:resetPassword",
        );

        return { success: true };
      });
      return runServerPromise(program);
    }),

  // --- VERIFY EMAIL (existing) ---
  verifyEmail: publicProcedure
    .input(compile(VerifyEmailInput))
    .mutation(({ input, ctx }) => {
      const { token } = input as typeof VerifyEmailInput.static;
      const program = Effect.gen(function* () {
        const storedToken = yield* Effect.tryPromise({
          try: () =>
            ctx.db
              .selectFrom("email_verification_token")
              .selectAll()
              .where("id", "=", token as EmailVerificationTokenId)
              .executeTakeFirst(),
          catch: () =>
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "DB Error",
            }),
        });

        if (storedToken) {
          yield* Effect.tryPromise({
            try: () =>
              ctx.db
                .deleteFrom("email_verification_token")
                .where("id", "=", token as EmailVerificationTokenId)
                .execute(),
            catch: () =>
              new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "DB Error",
              }),
          });
        }

        if (!storedToken || !isWithinExpirationDate(storedToken.expires_at)) {
          return yield* Effect.fail(
            new TRPCError({
              code: "BAD_REQUEST",
              message: "Token is invalid or has expired.",
            }),
          );
        }

        yield* Effect.tryPromise({
          try: () =>
            ctx.db
              .updateTable("user")
              .set({ email_verified: true })
              .where("id", "=", storedToken.user_id)
              .execute(),
          catch: () =>
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Could not verify email.",
            }),
        });
        yield* serverLog(
          "info",
          `Email verified for user ${storedToken.user_id}`,
          storedToken.user_id,
          "auth:verifyEmail",
        );
        return { success: true };
      });
      return runServerPromise(program);
    }),
});
