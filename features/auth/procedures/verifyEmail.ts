// features/auth/procedures/verifyEmail.ts
import { Effect } from "effect";
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

      // --- CORRECTED FIX ---
      // Validate the token exists and is not expired.
      // All subsequent logic is nested in this block to guarantee type safety.
      if (storedToken && isWithinExpirationDate(storedToken.expires_at)) {
        // `storedToken` is now guaranteed to be defined.
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
          "info",
          `Email verified for user ${user.id}`,
          user.id,
          "auth:verifyEmail",
        );

        const sessionId = yield* createSessionEffect(user.id);

        return { user, sessionId };
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
