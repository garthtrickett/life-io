// FILE: features/auth/procedures/requestPasswordReset.ts
import { Effect } from "effect";
import { publicProcedure } from "../../../trpc/trpc";
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

export const requestPasswordResetProcedure = publicProcedure
  .input(sRequestPasswordResetInput)
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
        catch: (cause) => new AuthDatabaseError({ cause }),
      });

      if (user) {
        const tokenId = yield* generateId(40);
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
              `[BACKGROUND] Failed to send password reset email: ${JSON.stringify(error)}`,
              user.id,
              "auth:requestPasswordReset:email",
            ),
          ),
        );

        // --- START OF FIX ---
        // Use forkDaemon to ensure the background task is not interrupted when the
        // parent fiber (the tRPC request) completes.
        yield* Effect.forkDaemon(emailEffect);
        // --- END OF FIX ---
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

    return handleTrpcProcedure(program);
  });
