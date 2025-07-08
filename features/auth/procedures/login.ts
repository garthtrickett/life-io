// FILE: features/auth/procedures/login.ts
import { Effect, Option } from "effect";
import { publicProcedure } from "../../../trpc/trpc";
import { sLoginInput } from "../schemas";
import { Db } from "../../../db/DbTag";
import { serverLog } from "../../../lib/server/logger.server";
import { argon2id, createSessionEffect } from "../../../lib/server/auth";
import {
  AuthDatabaseError,
  InvalidCredentialsError,
  EmailNotVerifiedError,
  PasswordHashingError,
} from "../Errors";
import { handleTrpcProcedure } from "../../../lib/server/runtime";

export const loginProcedure = publicProcedure
  .input(sLoginInput)
  .mutation(({ input }) => {
    const { email, password } = input;

    const program = Effect.gen(function* () {
      const db = yield* Db;
      yield* serverLog(
        "info",
        `Login attempt for user: ${email}`,
        undefined,
        "auth:login",
      );

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

      if (!user.password_hash) {
        yield* Effect.fail(new InvalidCredentialsError());
      }

      if (!user.email_verified) {
        yield* serverLog(
          "warn",
          `Login failed: Email not verified for ${user.id}`,
          user.id,
          "auth:login",
        );
        yield* Effect.fail(new EmailNotVerifiedError());
      }

      const isValidPassword = yield* Effect.tryPromise({
        try: () => argon2id.verify(user.password_hash, password),
        catch: (cause) => new PasswordHashingError({ cause }),
      });

      if (!isValidPassword) {
        yield* Effect.fail(new InvalidCredentialsError());
      }

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

    // The new helper function handles execution and error translation.
    return handleTrpcProcedure(program);
  });
