// FILE: features/auth/procedures/resetPassword.ts
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
import { handleTrpcProcedure } from "../../../lib/server/runtime";

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

      if (storedToken && isWithinExpirationDate(storedToken.expires_at)) {
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
          "info", // level
          { userId: storedToken.user_id }, // data
          "Password reset successful", // message
          "auth:resetPassword",
        );
        return { success: true };
      } else {
        yield* Effect.fail(new TokenInvalidError());
      }
    });

    return handleTrpcProcedure(program);
  });
