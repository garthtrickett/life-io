// features/auth/procedures/resetPassword.ts
import { Effect, pipe } from "effect";
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
  });
