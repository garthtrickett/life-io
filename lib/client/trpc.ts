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
    // 1️⃣  log everything first
    loggingLink<AppRouter>(),
    // 2️⃣  then send it over the wire
    httpBatchLink({
      url: "/trpc",
      transformer: superjson,
    }),
  ],
});
