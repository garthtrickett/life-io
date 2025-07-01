// File: trpc/routers/auth.ts
import { router, publicProcedure, loggedInProcedure } from "../trpc";
import { Effect, pipe, Option } from "effect";
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
import {
  AuthDatabaseError,
  EmailInUseError,
  EmailNotVerifiedError,
  EmailSendError,
  InvalidCredentialsError,
  PasswordHashingError,
  TokenCreationError,
  TokenInvalidError,
} from "../../features/auth/Errors";

// --- Schema Imports ---
import { Schema } from "@effect/schema";
import { s } from "../validator";
import { Db } from "../../db/DbTag";

// Define a reusable email schema filter, as it's not a built-in one.
const email = () =>
  Schema.pattern(
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/,
    { message: () => "Invalid email address" },
  );

// --- Input Schemas defined with Effect Schema ---
const SignupInput = Schema.Struct({
  email: Schema.String.pipe(email()),
  password: Schema.String.pipe(Schema.minLength(8)),
});

const LoginInput = Schema.Struct({
  email: Schema.String.pipe(email()),
  password: Schema.String,
});

const RequestPasswordResetInput = Schema.Struct({
  email: Schema.String.pipe(email()),
});

const ResetPasswordInput = Schema.Struct({
  token: Schema.String,
  password: Schema.String.pipe(Schema.minLength(8)),
});

const VerifyEmailInput = Schema.Struct({
  token: Schema.String,
});

const ChangePasswordInput = Schema.Struct({
  oldPassword: Schema.String,
  newPassword: Schema.String.pipe(Schema.minLength(8)),
});

export const authRouter = router({
  // --- SIGNUP ---
  signup: publicProcedure.input(s(SignupInput)).mutation(({ input }) => {
    const { email, password } = input;

    const program = Effect.gen(function* () {
      const db = yield* Db;
      yield* serverLog(
        "info",
        `Attempting to sign up user: ${email}`,
        undefined,
        "auth:signup",
      );

      const passwordHash = yield* Effect.tryPromise({
        try: () => argon2id.hash(password),
        catch: (cause) => new PasswordHashingError({ cause }),
      });

      const user = yield* Effect.tryPromise({
        try: () =>
          db
            .insertInto("user")
            .values({
              email: email.toLowerCase(),
              password_hash: passwordHash,
              permissions: [perms.note.read, perms.note.write],
              email_verified: false,
            } as NewUser)
            .returningAll()
            .executeTakeFirstOrThrow(),
        catch: (cause) => new EmailInUseError({ email, cause }),
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
          db
            .insertInto("email_verification_token")
            .values({
              id: verificationToken as EmailVerificationTokenId,
              user_id: user.id,
              email: user.email,
              expires_at: createDate(new TimeSpan(2, "h")),
            })
            .execute(),
        catch: (cause) => new TokenCreationError({ cause }),
      });

      const verificationLink = `http://localhost:5173/verify-email/${verificationToken}`;
      yield* sendEmail(
        user.email,
        "Verify Your Email Address",
        `<h1>Welcome!</h1><p>Click the link to verify your email: <a href="${verificationLink}">${verificationLink}</a></p>`,
      ).pipe(Effect.mapError((cause) => new EmailSendError({ cause })));

      yield* serverLog(
        "info",
        `Verification email sent for ${user.email}`,
        user.id,
        "auth:signup",
      );

      return { success: true, email: user.email };
    }).pipe(
      Effect.catchTags({
        PasswordHashingError: (e) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Could not hash password",
              cause: e.cause,
            }),
          ),
        EmailInUseError: (e) =>
          Effect.fail(
            new TRPCError({
              code: "CONFLICT",
              message: "An account with this email already exists.",
              cause: e.cause,
            }),
          ),
        TokenCreationError: (e) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Could not create verification token.",
              cause: e.cause,
            }),
          ),
        EmailSendError: (e) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Could not send verification email.",
              cause: e.cause,
            }),
          ),
      }),
    );

    return runServerPromise(program);
  }),

  // --- LOGIN (REFACTORED with Effect.gen and fixed logic) ---
  login: publicProcedure.input(s(LoginInput)).mutation(({ input }) => {
    const { email, password } = input;

    const program = Effect.gen(function* () {
      const db = yield* Db;
      yield* serverLog(
        "info",
        `Login attempt for user: ${email}`,
        undefined,
        "auth:login",
      );

      // 1. Find user or fail
      const user = yield* Effect.tryPromise({
        try: () =>
          db
            .selectFrom("user")
            .selectAll()
            .where("email", "=", email.toLowerCase())
            .executeTakeFirst(),
        catch: (cause) => new AuthDatabaseError({ cause }),
      }).pipe(
        Effect.flatMap(Option.fromNullable),
        Effect.catchTag("NoSuchElementException", () =>
          Effect.fail(new InvalidCredentialsError()),
        ),
      );

      // 2. Check for password hash
      if (!user.password_hash) {
        yield* Effect.fail(new InvalidCredentialsError());
      }

      // 3. Check if email is verified
      if (!user.email_verified) {
        yield* serverLog(
          "warn",
          `Login failed: Email not verified for ${user.id}`,
          user.id,
          "auth:login",
        );
        yield* Effect.fail(new EmailNotVerifiedError());
      }

      // 4. Verify password
      const isValidPassword = yield* Effect.tryPromise({
        try: () => argon2id.verify(user.password_hash, password),
        catch: (cause) => new PasswordHashingError({ cause }),
      });

      if (!isValidPassword) {
        yield* Effect.fail(new InvalidCredentialsError());
      }

      // 5. Create session
      const sessionId = yield* createSessionEffect(user.id).pipe(
        Effect.mapError((cause) => new AuthDatabaseError({ cause })),
      );
      yield* serverLog(
        "info",
        `Login successful for user: ${user.id}`,
        user.id,
        "auth:login",
      );

      return { sessionId, user };
    });

    return runServerPromise(
      program.pipe(
        Effect.catchTags({
          AuthDatabaseError: (e) =>
            Effect.fail(
              new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "A database error occurred.",
                cause: e.cause,
              }),
            ),
          InvalidCredentialsError: () =>
            Effect.fail(
              new TRPCError({
                code: "UNAUTHORIZED",
                message: "Incorrect email or password.",
              }),
            ),
          EmailNotVerifiedError: () =>
            Effect.fail(
              new TRPCError({
                code: "FORBIDDEN",
                message: "Please verify your email address before logging in.",
              }),
            ),
          PasswordHashingError: (e) =>
            Effect.fail(
              new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Could not process password.",
                cause: e.cause,
              }),
            ),
        }),
      ),
    );
  }),

  // --- CHANGE PASSWORD (REFACTORED with Effect.gen and fixed logic) ---
  changePassword: loggedInProcedure
    .input(s(ChangePasswordInput))
    .mutation(({ input, ctx }) => {
      const { oldPassword, newPassword } = input;
      const userId = ctx.user.id;

      const program = Effect.gen(function* () {
        const db = yield* Db;
        yield* serverLog(
          "info",
          `Password change attempt for user: ${userId}`,
          userId,
          "auth:changePassword",
        );

        const user = yield* Effect.tryPromise({
          try: () =>
            db
              .selectFrom("user")
              .select("password_hash")
              .where("id", "=", userId)
              .executeTakeFirstOrThrow(),
          catch: (cause) => new AuthDatabaseError({ cause }),
        });

        const isOldPasswordValid = yield* Effect.tryPromise({
          try: () => argon2id.verify(user.password_hash, oldPassword),
          catch: (cause) => new PasswordHashingError({ cause }),
        });

        if (!isOldPasswordValid) {
          yield* serverLog(
            "warn",
            `Incorrect old password provided for user: ${userId}`,
            userId,
            "auth:changePassword",
          );
          yield* Effect.fail(new InvalidCredentialsError());
        }

        const newPasswordHash = yield* Effect.tryPromise({
          try: () => argon2id.hash(newPassword),
          catch: (cause) => new PasswordHashingError({ cause }),
        });

        yield* Effect.tryPromise({
          try: () =>
            db
              .updateTable("user")
              .set({ password_hash: newPasswordHash })
              .where("id", "=", userId)
              .execute(),
          catch: (cause) => new AuthDatabaseError({ cause }),
        });

        yield* serverLog(
          "info",
          `Password changed successfully for user: ${userId}`,
          userId,
          "auth:changePassword",
        );

        return { success: true };
      }).pipe(
        Effect.catchTags({
          AuthDatabaseError: (e) =>
            Effect.fail(
              new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "A database error occurred.",
                cause: e.cause,
              }),
            ),
          PasswordHashingError: (e) =>
            Effect.fail(
              new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Could not process password.",
                cause: e.cause,
              }),
            ),
          InvalidCredentialsError: () =>
            Effect.fail(
              new TRPCError({
                code: "BAD_REQUEST",
                message: "Incorrect old password provided.",
              }),
            ),
        }),
      );
      return runServerPromise(program);
    }),

  // --- LOGOUT ---
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

  // --- ME ---
  me: publicProcedure.query(({ ctx }) => {
    return ctx.user;
  }),

  // --- REQUEST PASSWORD RESET ---
  requestPasswordReset: publicProcedure
    .input(s(RequestPasswordResetInput))
    .mutation(({ input }) => {
      const { email } = input;
      const program = Effect.gen(function* () {
        const db = yield* Db;
        yield* serverLog(
          "info",
          `Password reset requested for ${email}`,
          undefined,
          "auth:requestPasswordReset",
        );
        const user = yield* Effect.tryPromise({
          try: () =>
            db
              .selectFrom("user")
              .selectAll()
              .where("email", "=", email.toLowerCase())
              .executeTakeFirst(),
          catch: () => null,
        });

        if (user) {
          const tokenId = generateId(40);
          yield* Effect.tryPromise({
            try: () =>
              db
                .deleteFrom("password_reset_token")
                .where("user_id", "=", user.id)
                .execute(),
            catch: (cause) => new TokenCreationError({ cause }),
          });
          yield* Effect.tryPromise({
            try: () =>
              db
                .insertInto("password_reset_token")
                .values({
                  id: tokenId as PasswordResetTokenId,
                  user_id: user.id,
                  expires_at: createDate(new TimeSpan(2, "h")),
                })
                .execute(),
            catch: (cause) => new TokenCreationError({ cause }),
          });
          const resetLink = `http://localhost:5173/reset-password/${tokenId}`;
          yield* sendEmail(
            user.email,
            "Reset Your Password",
            `<h1>Password Reset</h1><p>Click the link to reset your password: <a href="${resetLink}">${resetLink}</a></p>`,
          ).pipe(Effect.mapError((cause) => new EmailSendError({ cause })));
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
      }).pipe(
        Effect.catchTags({
          TokenCreationError: (e) =>
            Effect.fail(
              new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Could not create reset token.",
                cause: e.cause,
              }),
            ),
          EmailSendError: (e) =>
            Effect.fail(
              new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Could not send reset email.",
                cause: e.cause,
              }),
            ),
        }),
      );
      return runServerPromise(program);
    }),

  // --- RESET PASSWORD (REFACTORED) ---
  resetPassword: publicProcedure
    .input(s(ResetPasswordInput))
    .mutation(({ input }) => {
      const { token, password } = input;
      const program = pipe(
        Db,
        Effect.flatMap((db) =>
          Effect.tryPromise({
            try: () =>
              db
                .selectFrom("password_reset_token")
                .selectAll()
                .where("id", "=", token as PasswordResetTokenId)
                .executeTakeFirst(),
            catch: (cause) => new AuthDatabaseError({ cause }),
          }),
        ),
        Effect.flatMap((storedToken) =>
          pipe(
            Effect.sync(() => storedToken),
            // FIX: Use !!t to check for both null and undefined
            Effect.filterOrFail(
              (t): t is NonNullable<typeof t> =>
                !!t && isWithinExpirationDate(t.expires_at),
              () => new TokenInvalidError(),
            ),
            Effect.tap((validToken) =>
              pipe(
                Db,
                Effect.flatMap((db) =>
                  Effect.tryPromise({
                    try: () =>
                      db
                        .deleteFrom("password_reset_token")
                        .where("id", "=", validToken.id)
                        .execute(),
                    catch: (cause) => new AuthDatabaseError({ cause }),
                  }),
                ),
              ),
            ),
          ),
        ),
        Effect.flatMap((storedToken) =>
          pipe(
            Effect.tryPromise({
              try: () => argon2id.hash(password),
              catch: (cause) => new PasswordHashingError({ cause }),
            }),
            Effect.flatMap((passwordHash) =>
              pipe(
                Db,
                Effect.flatMap((db) =>
                  Effect.tryPromise({
                    try: () =>
                      db
                        .updateTable("user")
                        .set({ password_hash: passwordHash })
                        .where("id", "=", storedToken.user_id)
                        .execute(),
                    catch: (cause) => new AuthDatabaseError({ cause }),
                  }),
                ),
                Effect.tap(() =>
                  serverLog(
                    "info",
                    `Password reset successfully for user ${storedToken.user_id}`,
                    storedToken.user_id,
                    "auth:resetPassword",
                  ),
                ),
              ),
            ),
          ),
        ),
        Effect.map(() => ({ success: true })),
      ).pipe(
        Effect.catchTags({
          TokenInvalidError: () =>
            Effect.fail(
              new TRPCError({
                code: "BAD_REQUEST",
                message: "Token is invalid or has expired.",
              }),
            ),
          PasswordHashingError: (e) =>
            Effect.fail(
              new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Could not hash password",
                cause: e.cause,
              }),
            ),
          AuthDatabaseError: (e) =>
            Effect.fail(
              new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "A database error occurred.",
                cause: e.cause,
              }),
            ),
        }),
      );
      return runServerPromise(program);
    }),

  // --- VERIFY EMAIL (REFACTORED) ---
  verifyEmail: publicProcedure
    .input(s(VerifyEmailInput))
    .mutation(({ input }) => {
      const { token } = input;
      const program = pipe(
        Db,
        Effect.flatMap((db) =>
          Effect.tryPromise({
            try: () =>
              db
                .selectFrom("email_verification_token")
                .selectAll()
                .where("id", "=", token as EmailVerificationTokenId)
                .executeTakeFirst(),
            catch: (cause) => new AuthDatabaseError({ cause }),
          }),
        ),
        Effect.flatMap((storedToken) =>
          pipe(
            Effect.sync(() => storedToken),
            // FIX: Use !!t to check for both null and undefined
            Effect.filterOrFail(
              (t): t is NonNullable<typeof t> =>
                !!t && isWithinExpirationDate(t.expires_at),
              () => new TokenInvalidError(),
            ),
            Effect.tap((validToken) =>
              pipe(
                Db,
                Effect.flatMap((db) =>
                  Effect.tryPromise({
                    try: () =>
                      db
                        .deleteFrom("email_verification_token")
                        .where("id", "=", validToken.id)
                        .execute(),
                    catch: (cause) => new AuthDatabaseError({ cause }),
                  }),
                ),
              ),
            ),
          ),
        ),
        Effect.flatMap((storedToken) =>
          pipe(
            Db,
            Effect.flatMap((db) =>
              Effect.tryPromise({
                try: () =>
                  db
                    .updateTable("user")
                    .set({ email_verified: true })
                    .where("id", "=", storedToken.user_id)
                    .execute(),
                catch: (cause) => new AuthDatabaseError({ cause }),
              }),
            ),
            Effect.tap(() =>
              serverLog(
                "info",
                `Email verified for user ${storedToken.user_id}`,
                storedToken.user_id,
                "auth:verifyEmail",
              ),
            ),
          ),
        ),
        Effect.map(() => ({ success: true })),
      ).pipe(
        Effect.catchTags({
          TokenInvalidError: () =>
            Effect.fail(
              new TRPCError({
                code: "BAD_REQUEST",
                message: "Token is invalid or has expired.",
              }),
            ),
          AuthDatabaseError: (e) =>
            Effect.fail(
              new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "A database error occurred.",
                cause: e.cause,
              }),
            ),
        }),
      );
      return runServerPromise(program);
    }),
});
