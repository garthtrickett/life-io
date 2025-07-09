// FILE: lib/server/auth.ts
import { TimeSpan, createDate } from "oslo";
import { alphabet, generateRandomString } from "oslo/crypto";
import { Argon2id } from "oslo/password";
import type { User } from "../../types/generated/public/User";
import type { SessionId } from "../../types/generated/public/Session";
import type { UserId } from "../../types/generated/public/User";
import { serverLog } from "./logger.server";
import { Effect, Option } from "effect";
import { Db } from "../../db/DbTag";
import { Schema } from "@effect/schema";
import { UserSchema } from "../shared/schemas";
import { formatErrorSync } from "@effect/schema/TreeFormatter";
import { AuthDatabaseError } from "../../features/auth/Errors"; // Import the tagged error

export const argon2id = new Argon2id();

/**
 * A reusable Effect to extract the session ID from a request's Cookie header.
 * @param request The incoming Fetch API Request object.
 * @returns An Effect that resolves to an Option of the session ID string.
 */
export const getSessionIdFromRequest = (
  request: Request,
): Effect.Effect<Option.Option<string>> =>
  Effect.sync(() => {
    const cookieHeader = request.headers.get("Cookie") ?? "";
    return Option.fromNullable(
      cookieHeader
        .split(";")
        .find((c) => c.trim().startsWith("session_id="))
        ?.split("=")[1],
    );
  });

export const createSessionEffect = (
  userId: string,
): Effect.Effect<string, AuthDatabaseError, Db> => // Updated error type
  Effect.gen(function* () {
    const db = yield* Db;
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
      // Use the new tagged error
      catch: (cause) => new AuthDatabaseError({ cause }),
    });
    yield* Effect.forkDaemon(
      serverLog("info", { userId }, "Session created", "Auth"),
    );
    return sessionId;
  });

export const deleteSessionEffect = (
  sessionId: string,
): Effect.Effect<void, AuthDatabaseError, Db> => // Updated error type
  Effect.gen(function* () {
    const db = yield* Db;
    yield* Effect.forkDaemon(
      serverLog(
        "info",
        { sessionId },
        "Attempting to delete session from DB",
        "Auth:deleteSession",
      ),
    );
    yield* Effect.tryPromise({
      try: () =>
        db
          .deleteFrom("session")
          .where("id", "=", sessionId as SessionId)
          .execute(),
      // Use the new tagged error
      catch: (cause) => new AuthDatabaseError({ cause }),
    });
    yield* Effect.forkDaemon(
      serverLog(
        "info",
        { sessionId },
        "DB operation to delete session completed",
        "Auth:deleteSession",
      ),
    );
  });

export const validateSessionEffect = (
  sessionId: string,
): Effect.Effect<
  { user: User | null; session: { id: string } | null },
  AuthDatabaseError, // Updated error type
  Db
> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const sessionOption = yield* Effect.tryPromise({
      try: () =>
        db
          .selectFrom("session")
          .selectAll()
          .where("id", "=", sessionId as SessionId)
          .executeTakeFirst(),
      catch: (cause) => new AuthDatabaseError({ cause }),
    }).pipe(Effect.map(Option.fromNullable));

    if (Option.isNone(sessionOption)) {
      yield* Effect.forkDaemon(
        serverLog("debug", { sessionId }, "Session not found", "Auth"),
      );
      return { user: null, session: null };
    }

    const session = sessionOption.value;

    if (session.expires_at < new Date()) {
      yield* Effect.forkDaemon(
        serverLog(
          "info",
          { sessionId, userId: session.user_id },
          "Expired session detected",
          "Auth",
        ),
      );
      yield* deleteSessionEffect(sessionId);
      return { user: null, session: null };
    }

    const maybeRawUser = yield* Effect.tryPromise({
      try: () =>
        db
          .selectFrom("user")
          .selectAll()
          .where("id", "=", session.user_id)
          .executeTakeFirst(),
      catch: (cause) => new AuthDatabaseError({ cause }),
    });

    // Flattened user decoding logic. This is much clearer than the previous nested pipe.
    const userOption = yield* Effect.matchEffect(
      Option.fromNullable(maybeRawUser),
      {
        onSuccess: (rawUser) =>
          Schema.decodeUnknown(UserSchema)(rawUser).pipe(
            Effect.map(Option.some), // On success, wrap the user in Some
            Effect.catchTag("ParseError", (e) =>
              serverLog(
                "warn",
                { userId: session.user_id, error: formatErrorSync(e) },
                "User validation failed",
                "Auth:validate",
              ).pipe(Effect.as(Option.none())),
            ),
          ),
        onFailure: () => Effect.succeed(Option.none<User>()),
      },
    );

    if (Option.isNone(userOption)) {
      yield* Effect.forkDaemon(
        serverLog(
          "error",
          { sessionId, userId: session.user_id },
          "Session validation failed: User not found for session",
          "Auth",
        ),
      );
      return { user: null, session: null };
    }

    const user = userOption.value;
    yield* Effect.forkDaemon(
      serverLog(
        "info",
        { user: user },
        "Session validated successfully",
        "Auth",
      ),
    );
    return { user, session: { id: session.id } };
  });
