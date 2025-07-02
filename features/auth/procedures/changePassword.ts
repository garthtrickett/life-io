// features/auth/procedures/changePassword.ts
import { Effect } from "effect";
import { loggedInProcedure } from "../../../trpc/trpc";
import { sChangePasswordInput } from "../schemas";
import { Db } from "../../../db/DbTag";
import { serverLog } from "../../../lib/server/logger.server";
import {
  AuthDatabaseError,
  InvalidCredentialsError,
  PasswordHashingError,
} from "../Errors";
import { argon2id } from "../../../lib/server/auth";
import { runServerPromise } from "../../../lib/server/runtime";
import { TRPCError } from "@trpc/server";

export const changePasswordProcedure = loggedInProcedure
  .input(sChangePasswordInput)
  .mutation(({ input, ctx }) => {
    const { oldPassword, newPassword } = input;
    const userId = ctx.user.id;

    const program = Effect.gen(function* () {
      const db = yield* Db;
      yield* serverLog(
        "info",
        `Password change attempt for user: ${userId}`,
        userId,
        "auth:changePassword",
      );

      const user = yield* Effect.tryPromise({
        try: () =>
          db
            .selectFrom("user")
            .select("password_hash")
            .where("id", "=", userId)
            .executeTakeFirstOrThrow(),
        catch: (cause) => new AuthDatabaseError({ cause }),
      });

      const isOldPasswordValid = yield* Effect.tryPromise({
        try: () => argon2id.verify(user.password_hash, oldPassword),
        catch: (cause) => new PasswordHashingError({ cause }),
      });

      if (!isOldPasswordValid) {
        yield* serverLog(
          "warn",
          `Incorrect old password provided for user: ${userId}`,
          userId,
          "auth:changePassword",
        );
        yield* Effect.fail(new InvalidCredentialsError());
      }

      const newPasswordHash = yield* Effect.tryPromise({
        try: () => argon2id.hash(newPassword),
        catch: (cause) => new PasswordHashingError({ cause }),
      });
      yield* Effect.tryPromise({
        try: () =>
          db
            .updateTable("user")
            .set({ password_hash: newPasswordHash })
            .where("id", "=", userId)
            .execute(),
        catch: (cause) => new AuthDatabaseError({ cause }),
      });
      yield* serverLog(
        "info",
        `Password changed successfully for user: ${userId}`,
        userId,
        "auth:changePassword",
      );
      return { success: true };
    }).pipe(
      Effect.catchTags({
        AuthDatabaseError: (e) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "A database error occurred.",
              cause: e.cause,
            }),
          ),
        PasswordHashingError: (e) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Could not process password.",
              cause: e.cause,
            }),
          ),
        InvalidCredentialsError: () =>
          Effect.fail(
            new TRPCError({
              code: "BAD_REQUEST",
              message: "Incorrect old password provided.",
            }),
          ),
      }),
    );
    return runServerPromise(program);
  });
