// FILE: features/auth/procedures/signup.ts
import { Effect } from "effect";
import { publicProcedure } from "../../../trpc/trpc";
import { sSignupInput } from "../schemas";
import { argon2id } from "../../../lib/server/auth";
import {
  PasswordHashingError,
  EmailInUseError,
  TokenCreationError,
  EmailSendError,
} from "../Errors";
import { Db } from "../../../db/DbTag";
import { serverLog } from "../../../lib/server/logger.server";
import { generateId } from "../../../lib/server/utils";
import type {
  NewUser,
  User,
  UserId,
} from "../../../types/generated/public/User";
// <-- FIX: Import UserId
import { perms } from "../../../lib/shared/permissions";
import type { EmailVerificationTokenId } from "../../../types/generated/public/EmailVerificationToken";
import { createDate, TimeSpan } from "oslo";
import { sendEmail } from "../../../lib/server/email";
import { handleTrpcProcedure } from "../../../lib/server/runtime";
import { Crypto } from "../../../lib/server/crypto"; // <-- FIX: Import Crypto
import { toError } from "../../../lib/shared/toError";

/* -------------------------------------------------------------------------- */
/* Effects                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Hashes a plaintext password.
 */
const hashPasswordEffect = (
  password: string,
): Effect.Effect<string, PasswordHashingError> =>
  Effect.tryPromise({
    try: () => argon2id.hash(password),
    catch: (cause) => new PasswordHashingError({ cause }),
  });
/**
 * Creates a new user in the database.
 */
const createUserEffect = (
  user: NewUser,
): Effect.Effect<User, EmailInUseError, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* Effect.tryPromise({
      try: () =>
        db
          .insertInto("user")
          .values(user)
          .returningAll()
          .executeTakeFirstOrThrow(),
      catch: (cause) => new EmailInUseError({ email: user.email, cause }),
    });
  });
/**
 * Creates and stores an email verification token for a user.
 */
const createVerificationTokenEffect = (
  userId: UserId, // <-- FIX: Added UserId type
  email: string, // <-- FIX: Added string type
): Effect.Effect<string, TokenCreationError, Db | Crypto> => // <-- FIX: Added Crypto to context
  Effect.gen(function* () {
    const db = yield* Db;
    const verificationToken = yield* generateId(40);
    yield* Effect.tryPromise({
      try: () =>
        db
          .insertInto("email_verification_token")
          .values({
            id: verificationToken as EmailVerificationTokenId,
            user_id: userId,
            email: email,
            expires_at: createDate(new TimeSpan(2, "h")),
          })
          .execute(),
      catch: (cause) => new TokenCreationError({ cause }),
    });
    return verificationToken;
  });
/**
 * Composes the logic for sending a verification email and forks it
 * as a background task.
 * Handles its own errors internally.
 */
const sendVerificationEmailDaemon = (
  user: User,
  token: string,
): Effect.Effect<void> => {
  const verificationLink = `http://localhost:5173/verify-email/${token}`;
  const emailEffect = sendEmail(
    user.email,
    "Verify Your Email Address",
    `<h1>Welcome!</h1><p>Click the link to verify your email: <a href="${verificationLink}">${verificationLink}</a></p>`,
  ).pipe(
    Effect.andThen(
      serverLog(
        "info",
        `Verification email sent for ${user.email}`,
        user.id,
        "auth:signup",
      ),
    ),
    Effect.mapError((cause) => new EmailSendError({ cause })),
    Effect.catchAll((error) =>
      serverLog(
        "error",
        `[BACKGROUND] Failed to send verification email. Error: ${
          toError(error).stack || toError(error).message
        }`,
        user.id,
        "auth:signup:email",
      ),
    ),
  );
  return Effect.forkDaemon(emailEffect);
};

/* -------------------------------------------------------------------------- */
/* Procedure                                                                  */
/* -------------------------------------------------------------------------- */

export const signupProcedure = publicProcedure
  .input(sSignupInput)
  .mutation(({ input }) => {
    const { email, password } = input;

    const program = Effect.gen(function* () {
      yield* serverLog(
        "info",
        `Attempting to sign up user: ${email}`,
        undefined,
        "auth:signup",
      );

      // 1. Hash the password
      const passwordHash = yield* hashPasswordEffect(password);

      // 2. Create the user
      const user = yield* createUserEffect({
        email: email.toLowerCase(),
        password_hash: passwordHash,
        permissions: [perms.note.read, perms.note.write],
        email_verified: false,
      } as NewUser);
      yield* serverLog(
        "info",
        `User created successfully: ${user.id}`,
        user.id,
        "auth:signup",
      );
      // 3. Create a verification token
      const verificationToken = yield* createVerificationTokenEffect(
        user.id,
        user.email,
      );
      // 4. Send the verification email in the background
      yield* sendVerificationEmailDaemon(user, verificationToken);
      return { success: true, email: user.email };
    });

    return handleTrpcProcedure(program);
  });
