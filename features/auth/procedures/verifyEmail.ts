// FILE: features/auth/procedures/verifyEmail.ts
import { Effect } from "effect";
import { publicProcedure } from "../../../trpc/trpc";
import { sVerifyEmailInput } from "../schemas";
import { Db } from "../../../db/DbTag";
import type { EmailVerificationTokenId } from "../../../types/generated/public/EmailVerificationToken";
import { isWithinExpirationDate } from "oslo";
import { AuthDatabaseError, TokenInvalidError } from "../Errors";
import { serverLog } from "../../../lib/server/logger.server";
import { createSessionEffect } from "../../../lib/server/auth";
import { handleTrpcProcedure } from "../../../lib/server/runtime";

export const verifyEmailProcedure = publicProcedure
  .input(sVerifyEmailInput)
  .mutation(({ input }) => {
    const { token } = input;

    const program = Effect.gen(function* () {
      const db = yield* Db;

      const storedToken = yield* Effect.tryPromise({
        try: () =>
          db
            .deleteFrom("email_verification_token")
            .where("id", "=", token as EmailVerificationTokenId)
            .returningAll()
            .executeTakeFirst(),
        catch: (cause) => new AuthDatabaseError({ cause }),
      });

      if (storedToken && isWithinExpirationDate(storedToken.expires_at)) {
        const user = yield* Effect.tryPromise({
          try: () =>
            db
              .updateTable("user")
              .set({ email_verified: true })
              .where("id", "=", storedToken.user_id)
              .returningAll()
              .executeTakeFirstOrThrow(),
          catch: (cause) => new AuthDatabaseError({ cause }),
        });
        yield* serverLog(
          "info", // level
          { user }, // data
          "Email verified for user", // message
          "auth:verifyEmail",
        );
        const sessionId = yield* createSessionEffect(user.id);

        return { user, sessionId };
      } else {
        yield* Effect.fail(new TokenInvalidError());
      }
    });

    return handleTrpcProcedure(program);
  });
