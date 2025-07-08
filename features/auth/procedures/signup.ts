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
import type { NewUser } from "../../../types/generated/public/User";
import { perms } from "../../../lib/shared/permissions";
import type { EmailVerificationTokenId } from "../../../types/generated/public/EmailVerificationToken";
import { createDate, TimeSpan } from "oslo";
import { sendEmail } from "../../../lib/server/email";
import { handleTrpcProcedure } from "../../../lib/server/runtime";

export const signupProcedure = publicProcedure
  .input(sSignupInput)
  .mutation(({ input }) => {
    const { email, password } = input;

    const program = Effect.gen(function* () {
      const db = yield* Db;
      yield* serverLog(
        "info",
        `Attempting to sign up user: ${email}`,
        undefined,
        "auth:signup",
      );

      const passwordHash = yield* Effect.tryPromise({
        try: () => argon2id.hash(password),
        catch: (cause) => new PasswordHashingError({ cause }),
      });

      const user = yield* Effect.tryPromise({
        try: () =>
          db
            .insertInto("user")
            .values({
              email: email.toLowerCase(),
              password_hash: passwordHash,
              permissions: [perms.note.read, perms.note.write],
              email_verified: false,
            } as NewUser)
            .returningAll()
            .executeTakeFirstOrThrow(),
        catch: (cause) => new EmailInUseError({ email, cause }),
      });
      yield* serverLog(
        "info",
        `User created successfully: ${user.id}`,
        user.id,
        "auth:signup",
      );

      const verificationToken = yield* generateId(40);
      yield* Effect.tryPromise({
        try: () =>
          db
            .insertInto("email_verification_token")
            .values({
              id: verificationToken as EmailVerificationTokenId,
              user_id: user.id,
              email: user.email,
              expires_at: createDate(new TimeSpan(2, "h")),
            })
            .execute(),
        catch: (cause) => new TokenCreationError({ cause }),
      });

      const verificationLink = `http://localhost:5173/verify-email/${verificationToken}`;

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
            `[BACKGROUND] Failed to send verification email: ${JSON.stringify(error)}`,
            user.id,
            "auth:signup:email",
          ),
        ),
      );

      // --- START OF FIX ---
      // Use forkDaemon to ensure the background task is not interrupted when the
      // parent fiber (the tRPC request) completes.
      yield* Effect.forkDaemon(emailEffect);
      // --- END OF FIX ---

      return { success: true, email: user.email };
    });

    return handleTrpcProcedure(program);
  });
