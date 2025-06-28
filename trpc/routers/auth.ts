// FILE: trpc/routers/auth.ts
import { router, publicProcedure, loggedInProcedure } from "../trpc";
import { t } from "elysia";
import { compile } from "@elysiajs/trpc";
import { Effect } from "effect";
import { DbLayer } from "../../db/DbLayer";
import { argon2id, createSession, deleteSession } from "../../lib/server/auth";
import { TRPCError } from "@trpc/server";
import type { NewUser } from "../../types/generated/public/User";

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
    .mutation(async ({ input, ctx }) => {
      const { email, password } = input as typeof SignupInput.static;
      const passwordHash = await argon2id.hash(password);

      const program = Effect.tryPromise({
        try: () =>
          ctx.db
            .insertInto("user")
            .values({
              email: email.toLowerCase(),
              password_hash: passwordHash,
              permissions: [],
            } as NewUser)
            .returningAll() // <-- Return the full user object
            .executeTakeFirstOrThrow(),
        catch: () =>
          new TRPCError({
            code: "CONFLICT",
            message: "An account with this email already exists.",
          }),
      }).pipe(Effect.provide(DbLayer));

      const user = await Effect.runPromise(program);
      const sessionId = await createSession(user.id);
      return { sessionId, user }; // <-- Return both session and user
    }),

  login: publicProcedure
    .input(compile(LoginInput))
    .mutation(async ({ input, ctx }) => {
      const { email, password } = input as typeof LoginInput.static;

      const user = await ctx.db
        .selectFrom("user")
        .selectAll()
        .where("email", "=", email.toLowerCase())
        .executeTakeFirst();

      if (!user || !user.password_hash) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid email or password.",
        });
      }

      const validPassword = await argon2id.verify(user.password_hash, password);
      if (!validPassword) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid email or password.",
        });
      }

      const sessionId = await createSession(user.id);
      return { sessionId, user }; // <-- Return both session and user
    }),

  logout: loggedInProcedure.mutation(async ({ ctx }) => {
    await deleteSession(ctx.session.id);
    return { success: true };
  }),

  me: publicProcedure.query(({ ctx }) => {
    return ctx.user;
  }),
});
