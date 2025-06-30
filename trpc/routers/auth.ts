// File: ./trpc/routers/auth.ts
// --- FIX START ---
import { router, publicProcedure, loggedInProcedure } from "../trpc";
import { t } from "elysia";
import { compile } from "@elysiajs/trpc";
import { Effect } from "effect";
import {
  argon2id,
  createSessionEffect,
  deleteSessionEffect,
} from "../../lib/server/auth";
import { TRPCError } from "@trpc/server";
import type { NewUser } from "../../types/generated/public/User";
import { perms } from "../../lib/shared/permissions";
import { runServerPromise } from "../../lib/server/runtime";
import { serverLog } from "../../lib/server/logger.server";

const SignupInput = t.Object({
  email: t.String({ format: "email" }),
  password: t.String({ minLength: 8 }),
});

const LoginInput = t.Object({
  email: t.String({ format: "email" }),
  password: t.String(),
});

export const authRouter = router({
  signup: publicProcedure
    .input(compile(SignupInput))
    .mutation(({ input, ctx }) => {
      const { email, password } = input as typeof SignupInput.static;

      const program = Effect.gen(function* () {
        yield* serverLog(
          "info",
          `Attempting to sign up user: ${email}`,
          undefined,
          "auth:signup",
        );
        const passwordHash = yield* Effect.tryPromise({
          try: () => argon2id.hash(password),
          catch: () =>
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Could not hash password",
            }),
        });

        yield* serverLog(
          "info",
          `Password hashed for user: ${email}`,
          undefined,
          "auth:signup",
        );

        const user = yield* Effect.tryPromise({
          try: () =>
            ctx.db
              .insertInto("user")
              .values({
                email: email.toLowerCase(),
                password_hash: passwordHash,
                permissions: [perms.note.read, perms.note.write],
              } as NewUser)
              .returningAll()
              .executeTakeFirstOrThrow(),
          catch: () =>
            new TRPCError({
              code: "CONFLICT",
              message: "An account with this email already exists.",
            }),
        });

        yield* serverLog(
          "info",
          `User created successfully: ${user.id}`,
          user.id,
          "auth:signup",
        );
        const sessionId = yield* createSessionEffect(user.id);
        return { sessionId, user };
      });

      return runServerPromise(program);
    }),

  login: publicProcedure
    .input(compile(LoginInput))
    .mutation(({ input, ctx }) => {
      const { email, password } = input as typeof LoginInput.static;

      const program = Effect.gen(function* () {
        yield* serverLog(
          "info",
          `Login attempt for user: ${email}`,
          undefined,
          "auth:login",
        );

        const user = yield* Effect.tryPromise({
          try: () =>
            ctx.db
              .selectFrom("user")
              .selectAll()
              .where("email", "=", email.toLowerCase())
              .executeTakeFirst(),
          catch: (e) =>
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: String(e),
            }),
        });

        if (!user || !user.password_hash) {
          yield* serverLog(
            "warn",
            `Login failed: User not found for email: ${email}`,
            undefined,
            "auth:login",
          );
          return yield* Effect.fail(
            new TRPCError({
              code: "BAD_REQUEST",
              message: "Invalid email or password.",
            }),
          );
        }

        const validPassword = yield* Effect.tryPromise({
          try: () => argon2id.verify(user.password_hash, password),
          catch: (e) =>
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: String(e),
            }),
        });

        if (!validPassword) {
          yield* serverLog(
            "warn",
            `Login failed: Invalid password for user: ${user.id}`,
            user.id,
            "auth:login",
          );
          return yield* Effect.fail(
            new TRPCError({
              code: "BAD_REQUEST",
              message: "Invalid email or password.",
            }),
          );
        }

        yield* serverLog(
          "info",
          `Login successful for user: ${user.id}`,
          user.id,
          "auth:login",
        );
        const sessionId = yield* createSessionEffect(user.id);
        return { sessionId, user };
      });

      return runServerPromise(program);
    }),

  logout: loggedInProcedure.mutation(({ ctx }) => {
    const program = Effect.gen(function* () {
      yield* serverLog(
        "info",
        `User initiated logout.`,
        ctx.user.id,
        "auth:logout",
      );
      yield* deleteSessionEffect(ctx.session.id);
      return { success: true };
    });
    return runServerPromise(program);
  }),

  me: publicProcedure.query(({ ctx }) => {
    return ctx.user;
  }),
});
// --- FIX END ---
