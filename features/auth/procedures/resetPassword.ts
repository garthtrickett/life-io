// features/auth/procedures/resetPassword.ts
import { Effect } from "effect";
import { publicProcedure } from "../../../trpc/trpc";
import { sResetPasswordInput } from "../schemas";
import { Db } from "../../../db/DbTag";
import {
  AuthDatabaseError,
  PasswordHashingError,
  TokenInvalidError,
} from "../Errors";
import type { PasswordResetTokenId } from "../../../types/generated/public/PasswordResetToken";
import { isWithinExpirationDate } from "oslo";
import { argon2id } from "../../../lib/server/auth";
import { serverLog } from "../../../lib/server/logger.server";
import { runServerPromise } from "../../../lib/server/runtime";
import { TRPCError } from "@trpc/server";

export const resetPasswordProcedure = publicProcedure
  .input(sResetPasswordInput)
  .mutation(({ input }) => {
    const { token, password } = input;

    const program = Effect.gen(function* () {
      const db = yield* Db;

      const storedToken = yield* Effect.tryPromise({
        try: () =>
          db
            .selectFrom("password_reset_token")
            .selectAll()
            .where("id", "=", token as PasswordResetTokenId)
            .executeTakeFirst(),
        catch: (cause) => new AuthDatabaseError({ cause }),
      });

      // --- CORRECTED FIX ---
      // Check for a valid and non-expired token. The rest of the logic is nested
      // inside this block, guaranteeing `storedToken` is defined and valid.
      if (storedToken && isWithinExpirationDate(storedToken.expires_at)) {
        // Now, all subsequent uses of `storedToken` are safe.
        yield* Effect.tryPromise({
          try: () =>
            db
              .deleteFrom("password_reset_token")
              .where("id", "=", storedToken.id)
              .execute(),
          catch: (cause) => new AuthDatabaseError({ cause }),
        });

        const newPasswordHash = yield* Effect.tryPromise({
          try: () => argon2id.hash(password),
          catch: (cause) => new PasswordHashingError({ cause }),
        });

        yield* Effect.tryPromise({
          try: () =>
            db
              .updateTable("user")
              .set({ password_hash: newPasswordHash })
              .where("id", "=", storedToken.user_id)
              .execute(),
          catch: (cause) => new AuthDatabaseError({ cause }),
        });

        yield* serverLog(
          "info",
          `Password reset successfully for user ${storedToken.user_id}`,
          storedToken.user_id,
          "auth:resetPassword",
        );

        return { success: true };
      } else {
        // If the token is invalid or expired, fail the Effect.
        yield* Effect.fail(new TokenInvalidError());
      }
    }).pipe(
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
  });
