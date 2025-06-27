// File: ./trpc/context.ts

import { db } from "../db/kysely";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";

/**
 * A helper function to simulate getting a user from request headers.
 * In a real application, you would validate a JWT or session cookie here.
 */
const getUserFromRequest = (req: Request) => {
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    // In a real app, validate the token and look up the user in the database.
    // For now, we'll return a mock user if a token exists.
    return {
      id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      email: "test@example.com",
    };
  }
  return null;
};

/**
 * This function is called for every tRPC request.
 * It receives the raw HTTP request and returns the context object.
 */
export const createContext = async ({ req }: FetchCreateContextFnOptions) => {
  const user = getUserFromRequest(req);

  // This object is what becomes `ctx` in your tRPC procedures
  return {
    db, // Provide the Kysely database instance
    user, // Provide the authenticated user (or null)
  };
};

// This export is used by tRPC to infer the context type
export type Context = Awaited<ReturnType<typeof createContext>>;
