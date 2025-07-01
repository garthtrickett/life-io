// File: trpc/context.ts
// --- REMOVED ---
// import { db } from "../db/kysely";

import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { validateSessionEffect } from "../lib/server/auth";
import { runServerPromise } from "../lib/server/runtime";
import { Effect, Option } from "effect";
import type { User } from "../types/generated/public/User";
import type { Kysely } from "kysely";
import type { Database } from "../types";
// --- ADDED ---
import { Db } from "../db/DbTag";

/**
 * The context created for each tRPC request, containing the database
 * instance and authentication state.
 */
export interface Context {
  readonly db: Kysely<Database>;
  readonly user: User | null;
  readonly session: { id: string } | null;
}

/**
 * A "pure" Effect that describes how to create the tRPC context.
 * It retrieves the session from the request, validates it, and returns
 * the context with the user and session information.
 *
 * --- MODIFIED: It now depends on the `Db` service ---
 * @param opts Options from the tRPC fetch adapter, including the request object.
 * @returns An `Effect` that resolves to the `Context`.
 */
const createContextEffect = ({
  req,
}: FetchCreateContextFnOptions): Effect.Effect<Context, Error, Db> =>
  Effect.gen(function* () {
    const db = yield* Db; // Get the DB instance from the context
    const cookieHeader = req.headers.get("Cookie") ?? "";
    const sessionIdOption = Option.fromNullable(
      cookieHeader
        .split(";")
        .find((c) => c.trim().startsWith("session_id="))
        ?.split("=")[1],
    );

    // If there's no session ID, return a context for an unauthenticated user.
    if (Option.isNone(sessionIdOption)) {
      // Use the db instance from the context here
      return { db, user: null, session: null };
    }

    // If a session ID exists, validate it and return the resulting context.
    const { user, session } = yield* validateSessionEffect(
      sessionIdOption.value,
    );
    // And also use the db instance from the context here
    return { db, user, session };
  });

/**
 * The async function that tRPC's fetch adapter calls.
 * It creates the context by running our "pure" `createContextEffect`
 * using the server's Effect runtime.
 */
export const createContext = (
  opts: FetchCreateContextFnOptions,
): Promise<Context> => {
  // runServerPromise will provide the necessary DbLayer
  return runServerPromise(createContextEffect(opts));
};
