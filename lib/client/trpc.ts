// FILE: src/lib/client/trpc.ts
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../trpc/router";
import { loggingLink } from "./loggingLink";

/**
 * Front-end tRPC client with superjson and our custom
 * logging link plugged in.
 */
export const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    loggingLink<AppRouter>(),
    httpBatchLink({
      // --- START OF FIX ---
      url: "/api/trpc", // All tRPC calls now go through /api/trpc
      // --- END OF FIX ---
      transformer: superjson,
    }),
  ],
});
