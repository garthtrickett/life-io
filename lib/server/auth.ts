// lib/server/auth.ts
import { TimeSpan, createDate } from "oslo";
import { alphabet, generateRandomString } from "oslo/crypto";
import { Argon2id } from "oslo/password";
import { db } from "../../db/kysely";
import type { User } from "../../types/generated/public/User";
import type { SessionId } from "../../types/generated/public/Session";
import type { UserId } from "../../types/generated/public/User";
import { runServerPromise } from "./runtime";
import { serverLog } from "./logger.server";
import { Effect, Option } from "effect";

export const argon2id = new Argon2id();

export const createSessionEffect = (
  userId: string,
): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    const sessionId = generateRandomString(40, alphabet("a-z", "0-9"));
    const expiresAt = createDate(new TimeSpan(30, "d"));
    yield* Effect.tryPromise({
      try: () =>
        db
          .insertInto("session")
          .values({
            id: sessionId as SessionId,
            user_id: userId as UserId,
            expires_at: expiresAt,
          })
          .execute(),
      catch: (e) => new Error(String(e)),
    });
    yield* Effect.forkDaemon(
      serverLog("info", `Session created for user ${userId}`, userId, "Auth"),
    );
    return sessionId;
  });

export const deleteSessionEffect = (
  sessionId: string,
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () =>
        db
          .deleteFrom("session")
          .where("id", "=", sessionId as SessionId)
          .execute(),
      catch: (e) => new Error(String(e)),
    });
    yield* Effect.forkDaemon(
      serverLog("info", `Session ${sessionId} deleted.`, undefined, "Auth"),
    );
  });

/**
 * Validates a session ID and returns the user and session.
 * This is now an Effect program for better safety and composability.
 */
export const validateSessionEffect = (
  sessionId: string,
): Effect.Effect<
  { user: User | null; session: { id: string } | null },
  Error
> =>
  Effect.gen(function* () {
    const sessionOption = yield* Effect.tryPromise({
      try: () =>
        db
          .selectFrom("session")
          .selectAll()
          .where("id", "=", sessionId as SessionId)
          .executeTakeFirst(),
      catch: (e) => new Error(String(e)),
    }).pipe(Effect.map(Option.fromNullable));

    if (Option.isNone(sessionOption)) {
      yield* Effect.forkDaemon(
        serverLog(
          "debug",
          `Session not found: ${sessionId}`,
          undefined,
          "Auth",
        ),
      );
      return { user: null, session: null };
    }

    const session = sessionOption.value;

    if (session.expires_at < new Date()) {
      yield* Effect.forkDaemon(
        serverLog(
          "info",
          `Expired session detected: ${sessionId}`,
          session.user_id,
          "Auth",
        ),
      );
      yield* deleteSessionEffect(sessionId);
      return { user: null, session: null };
    }

    const userOption = yield* Effect.tryPromise({
      try: () =>
        db
          .selectFrom("user")
          .selectAll()
          .where("id", "=", session.user_id)
          .executeTakeFirst(),
      catch: (e) => new Error(String(e)),
    }).pipe(Effect.map(Option.fromNullable));

    if (Option.isNone(userOption)) {
      yield* Effect.forkDaemon(
        serverLog(
          "error",
          `Session validation failed: User not found for session ${sessionId}`,
          session.user_id,
          "Auth",
        ),
      );
      return { user: null, session: null };
    }

    const user = userOption.value;
    yield* Effect.forkDaemon(
      serverLog(
        "info",
        `Session validated successfully for user ${user.id}`,
        user.id,
        "Auth",
      ),
    );

    return { user, session: { id: session.id } };
  });

// The async version is kept for compatibility if needed, but new code should use the Effect version.
export const validateSession = (sessionId: string) =>
  runServerPromise(validateSessionEffect(sessionId));
