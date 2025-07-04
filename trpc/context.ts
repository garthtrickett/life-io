// File: trpc/context.ts
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import {
  validateSessionEffect,
  getSessionIdFromRequest,
} from "../lib/server/auth"; // Import new helper
import { runServerPromise } from "../lib/server/runtime";
import { Effect, Option } from "effect";
import type { User } from "../types/generated/public/User";
import type { Kysely } from "kysely";
import type { Database } from "../types";
import { Db } from "../db/DbTag";

export interface Context {
  readonly db: Kysely<Database>;
  readonly user: User | null;
  readonly session: { id: string } | null;
}

const createContextEffect = ({
  req,
}: FetchCreateContextFnOptions): Effect.Effect<Context, Error, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const sessionIdOption = yield* getSessionIdFromRequest(req); // Use the new helper

    return yield* Option.match(sessionIdOption, {
      onNone: () => Effect.succeed({ db, user: null, session: null }),
      onSome: (sessionId) =>
        Effect.gen(function* () {
          const { user, session } = yield* validateSessionEffect(sessionId);
          return { db, user, session };
        }),
    });
  });

export const createContext = (
  opts: FetchCreateContextFnOptions,
): Promise<Context> => {
  return runServerPromise(createContextEffect(opts));
};
