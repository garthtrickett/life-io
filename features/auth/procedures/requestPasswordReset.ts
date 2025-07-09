// FILE: features/auth/procedures/requestPasswordReset.ts
import { Effect, Option } from "effect";
import { rateLimitedProcedure } from "../../../trpc/trpc";
import { sRequestPasswordResetInput } from "../schemas";
import { Db } from "../../../db/DbTag";
import { serverLog } from "../../../lib/server/logger.server";
import { generateId } from "../../../lib/server/utils";
import { createDate, TimeSpan } from "oslo";
import type { PasswordResetTokenId } from "../../../types/generated/public/PasswordResetToken";
import { sendEmail } from "../../../lib/server/email";
import {
  EmailSendError,
  TokenCreationError,
  AuthDatabaseError,
} from "../Errors";
import { handleTrpcProcedure } from "../../../lib/server/runtime";
import type { User, UserId } from "../../../types/generated/public/User";
import { Crypto } from "../../../lib/server/crypto";
import { toError } from "../../../lib/shared/toError";
// <-- FIX: Import Crypto

/* -------------------------------------------------------------------------- */
/* Effects                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Finds a user by their email address.
 * Returns an Option to explicitly handle the case where a user is not found.
 * NOTE: This is duplicated from login.ts to maintain locality of behavior.
 * In a larger app, this might live in a shared effects file.
 */
const findUserByEmailEffect = (
  email: string,
): Effect.Effect<Option.Option<User>, AuthDatabaseError, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const maybeUser = yield* Effect.tryPromise({
      try: () =>
        db
          .selectFrom("user")
          .selectAll()
          .where("email", "=", email.toLowerCase())
          .executeTakeFirst(),
      catch: (cause) => new AuthDatabaseError({ cause }),
    });
    return Option.fromNullable(maybeUser);
  });
/**
 * Creates and stores a password reset token for a user.
 */
const createPasswordResetTokenEffect = (
  userId: UserId,
): Effect.Effect<string, TokenCreationError, Db | Crypto> => // <-- FIX: Added Crypto to context
  Effect.gen(function* () {
    const db = yield* Db;
    const tokenId = yield* generateId(40);

    // Invalidate old tokens
    yield* Effect.tryPromise({
      try: () =>
        db
          .deleteFrom("password_reset_token")
          .where("user_id", "=", userId)
          .execute(),
      catch: (cause) => new TokenCreationError({ cause }),
    });

    // Insert new token
    yield* Effect.tryPromise({
      try: () =>
        db
          .insertInto("password_reset_token")
          .values({
            id: tokenId as PasswordResetTokenId,
            user_id: userId,
            expires_at: createDate(new TimeSpan(2, "h")),
          })
          .execute(),
      catch: (cause) => new TokenCreationError({ cause }),
    });

    return tokenId;
  });
/**
 * Composes the logic for sending a password reset email and forks it
 * as a background task.
 * Handles its own errors internally.
 */
const sendPasswordResetEmailDaemon = (
  user: User,
  token: string,
): Effect.Effect<void> => {
  const resetLink = `http://localhost:5173/reset-password/${token}`;
  const emailEffect = sendEmail(
    user.email,
    "Reset Your Password",
    `<h1>Password Reset</h1><p>Click the link to reset your password: <a href="${resetLink}">${resetLink}</a></p>`,
  ).pipe(
    Effect.andThen(
      serverLog(
        "info",
        `Password reset token created and email sent for ${user.email}`,
        user.id,
        "auth:requestPasswordReset",
      ),
    ),
    Effect.mapError((cause) => new EmailSendError({ cause })),
    Effect.catchAll((error) =>
      serverLog(
        "error",
        `[BACKGROUND] Failed to send password reset email. Error: ${
          toError(error).stack || toError(error).message
        }`,
        user.id,
        "auth:requestPasswordReset:email",
      ),
    ),
  );
  return Effect.forkDaemon(emailEffect);
};

/* -------------------------------------------------------------------------- */
/* Procedure                                                                  */
/* -------------------------------------------------------------------------- */

export const requestPasswordResetProcedure = rateLimitedProcedure
  .input(sRequestPasswordResetInput)
  .mutation(({ input }) => {
    const { email } = input;

    const program = Effect.gen(function* () {
      yield* serverLog(
        "info",
        `Password reset requested for ${email}`,
        undefined,
        "auth:requestPasswordReset",
      );

      // 1. Find the user by email
      const maybeUser = yield* findUserByEmailEffect(email);

      // 2. If the user exists, create and send a reset token
      yield* Option.match(maybeUser, {
        onNone: () =>
          serverLog(
            "info",
            `Password reset requested for non-existent user: ${email}`,
            undefined,
            "auth:requestPasswordReset",
          ),
        onSome: (user) =>
          Effect.gen(function* () {
            const token = yield* createPasswordResetTokenEffect(user.id);
            yield* sendPasswordResetEmailDaemon(user, token);
          }),
      });

      return { success: true };
    });

    return handleTrpcProcedure(program);
  });
