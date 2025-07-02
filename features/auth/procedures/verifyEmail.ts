// features/auth/procedures/verifyEmail.ts
import { Effect, pipe, Option } from "effect";
import { publicProcedure } from "../../../trpc/trpc";
import { sVerifyEmailInput } from "../schemas";
import { Db } from "../../../db/DbTag";
import type { EmailVerificationTokenId } from "../../../types/generated/public/EmailVerificationToken";
import { isWithinExpirationDate } from "oslo";
import { AuthDatabaseError, TokenInvalidError } from "../Errors";
import { serverLog } from "../../../lib/server/logger.server";
import { createSessionEffect } from "../../../lib/server/auth";
import { runServerPromise } from "../../../lib/server/runtime";
import { TRPCError } from "@trpc/server";

export const verifyEmailProcedure = publicProcedure
  .input(sVerifyEmailInput)
  .mutation(({ input }) => {
    const { token } = input;
    const program = pipe(
      Db,
      Effect.flatMap((db) =>
        Effect.tryPromise({
          try: () =>
            db
              .deleteFrom("email_verification_token")
              .where("id", "=", token as EmailVerificationTokenId)
              .returningAll()
              .executeTakeFirst(),
          catch: (cause) => new AuthDatabaseError({ cause }),
        }),
      ),
      Effect.flatMap(Option.fromNullable),
      Effect.filterOrFail(
        (t) => isWithinExpirationDate(t.expires_at),
        () => new TokenInvalidError(),
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
                  .returningAll()
                  .executeTakeFirstOrThrow(),
              catch: (cause) => new AuthDatabaseError({ cause }),
            }),
          ),
          Effect.tap((validToken) =>
            serverLog(
              "info",
              `Email verified for user ${validToken.id}`,
              validToken.id,
              "auth:verifyEmail",
            ),
          ),
        ),
      ),
      Effect.flatMap((user) =>
        pipe(
          createSessionEffect(user.id),
          Effect.map((sessionId) => ({ user, sessionId })),
        ),
      ),
      Effect.catchTags({
        NoSuchElementException: () => Effect.fail(new TokenInvalidError()),
      }),
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
  });
