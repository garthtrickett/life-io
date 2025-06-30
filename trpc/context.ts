// File: ./trpc/context.ts
import { db } from "../db/kysely";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { validateSessionEffect } from "../lib/server/auth";
import { runServerPromise } from "../lib/server/runtime";

export const createContext = async ({ req }: FetchCreateContextFnOptions) => {
  // A simple way to get a cookie, in a real app you might use a library
  const cookieHeader = req.headers.get("Cookie") ?? "";
  const sessionId = cookieHeader
    .split(";")
    .find((c) => c.trim().startsWith("session_id="))
    ?.split("=")[1];

  if (!sessionId) {
    return { db, user: null, session: null };
  }

  const { user, session } = await runServerPromise(
    validateSessionEffect(sessionId),
  );

  return {
    db,
    user,
    session,
  };
};

export type Context = Awaited<ReturnType<typeof createContext>>;
