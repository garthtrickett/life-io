// File: ./trpc/trpc.ts

import { initTRPC } from "@trpc/server";
import type { Context } from "./context"; // 👈 Import the Context type

// Initialize tRPC with the new context type
const t = initTRPC.context<Context>().create();

// Export the reusable router and procedure helpers
export const router = t.router;
export const publicProcedure = t.procedure;
