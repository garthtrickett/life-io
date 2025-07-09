// FILE: features/auth/procedures/login.ts
import { Effect, Option } from "effect";
import { rateLimitedProcedure } from "../../../trpc/trpc";
import { sLoginInput } from "../schemas";
import { Db } from "../../../db/DbTag";
import { serverLog } from "../../../lib/server/logger.server";
import { createSessionEffect, argon2id } from "../../../lib/server/auth";
import {
  AuthDatabaseError,
  InvalidCredentialsError,
  EmailNotVerifiedError,
  PasswordHashingError,
} from "../Errors";
import { handleTrpcProcedure } from "../../../lib/server/runtime";
import type { User } from "../../../types/generated/public/User";

/* -------------------------------------------------------------------------- */
/* Effects                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Finds a user by their email address.
 * Returns an Option to explicitly handle the case where a user is not found.
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
 * Verifies a plaintext password against a stored hash.
 */
const verifyPasswordEffect = (
  plaintext: string,
  hash: string,
): Effect.Effect<boolean, PasswordHashingError> =>
  Effect.tryPromise({
    try: () => argon2id.verify(hash, plaintext),
    catch: (cause) => new PasswordHashingError({ cause }),
  });

/**
 * Handles the logic for a user login, including checks and session creation.
 */
const loginUserEffect = (
  user: User,
  password: string, // <-- FIX: Added 'string' type
): Effect.Effect<
  { user: User; sessionId: string },
  | InvalidCredentialsError
  | EmailNotVerifiedError
  | PasswordHashingError
  | AuthDatabaseError,
  Db
> =>
  Effect.gen(function* () {
    if (!user.password_hash) {
      yield* Effect.fail(new InvalidCredentialsError());
    }

    if (!user.email_verified) {
      yield* serverLog(
        "warn", // level
        { user }, // data
        "Login failed: Email not verified", // message
        "auth:login",
      );
      yield* Effect.fail(new EmailNotVerifiedError());
    }

    const isValidPassword = yield* verifyPasswordEffect(
      password,
      user.password_hash,
    );
    if (!isValidPassword) {
      yield* Effect.fail(new InvalidCredentialsError());
    }

    const sessionId = yield* createSessionEffect(user.id).pipe(
      Effect.mapError((cause) => new AuthDatabaseError({ cause })),
    );
    yield* serverLog(
      "info", // level
      { user }, // data
      "Login successful", // message
      "auth:login",
    );

    return { sessionId, user };
  });

/* -------------------------------------------------------------------------- */
/* Procedure                                                                  */
/* -------------------------------------------------------------------------- */

export const loginProcedure = rateLimitedProcedure
  .input(sLoginInput)
  .mutation(({ input }) => {
    const { email, password } = input;

    const program = Effect.gen(function* () {
      yield* serverLog(
        "info", // level
        { email }, // data
        "Login attempt", // message
        "auth:login",
      );

      // 1. Find the user by email.
      const maybeUser = yield* findUserByEmailEffect(email);

      // 2. If user exists, attempt to log them in.
      return yield* Option.match(maybeUser, {
        onNone: () => Effect.fail(new InvalidCredentialsError()),
        onSome: (user) => loginUserEffect(user, password),
      });
    });

    // The new helper function handles execution and error translation.
    return handleTrpcProcedure(program);
  });
