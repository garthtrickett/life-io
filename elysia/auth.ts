// File: elysia/auth.ts
import { Effect, Option } from "effect";
import {
  validateSessionEffect,
  getSessionIdFromRequest,
} from "../lib/server/auth"; // Import new helper
import { AuthError } from "./errors";

/**
 * A reusable Effect to authenticate a request by validating its session cookie.
 * @param request The incoming Fetch API Request object.
 * @returns An Effect that succeeds with the User object or fails with an AuthError.
 */
export const authenticateRequestEffect = (request: Request) =>
  Effect.gen(function* () {
    const sessionIdOption = yield* getSessionIdFromRequest(request); // Use the new helper

    if (Option.isNone(sessionIdOption)) {
      return yield* Effect.fail(
        new AuthError({ message: "Unauthorized: No session ID found." }),
      );
    }

    const { user } = yield* validateSessionEffect(sessionIdOption.value).pipe(
      Effect.mapError(
        () => new AuthError({ message: "Session validation failed." }),
      ),
    );

    if (!user) {
      return yield* Effect.fail(
        new AuthError({ message: "Unauthorized: Invalid session." }),
      );
    }

    return user;
  });
