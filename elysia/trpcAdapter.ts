// File: elysia/trpcAdapter.ts

import { type AnyRouter } from "@trpc/server";
import { resolveResponse } from "@trpc/server/http";
import type { Context, ElysiaContext } from "../trpc/context";
// Import the full Elysia Context type to correctly type the handler's parameter
import type { Context as ElysiaHandlerContext } from "elysia";

interface ElysiaTrpcAdapterOptions {
  router: AnyRouter;
  createContext: (ctx: ElysiaContext) => Promise<Context>;
}

/**
 * A custom tRPC adapter for Elysia.
 * This function creates a request handler that correctly bridges the full
 * Elysia context (including `ip`, `request`, etc.) to the tRPC `createContext` function.
 */
export const createElysiaTrpcAdapter = (opts: ElysiaTrpcAdapterOptions) => {
  // By adding `& { ip: string }`, we tell TypeScript that the context object
  // passed to this handler will have the `ip` property, in addition to
  // all the properties of the base Elysia context.
  return async (
    ctx: ElysiaHandlerContext & { ip: string },
  ): Promise<Response> => {
    const path = new URL(ctx.request.url).pathname.substring(
      "/api/trpc/".length,
    );

    // Instead of passing the whole `ctx` object, create a new object that
    // perfectly matches our `ElysiaContext` interface. This is now type-safe.
    const trpcContext = await opts.createContext({
      request: ctx.request,
      ip: ctx.ip,
    });

    // For GET requests, we can pass the original request directly to tRPC.
    // This is safer as it avoids potential issues from unnecessarily
    // reconstructing the request object.
    if (ctx.request.method === "GET" || ctx.request.method === "HEAD") {
      return resolveResponse({
        router: opts.router,
        req: ctx.request, // Use the original, untouched request
        path,
        // --- FIX: Remove `async` and use `Promise.resolve` to satisfy the linter ---
        createContext: () => Promise.resolve(trpcContext),
        error: null,
      });
    }

    // For POST/other methods, we *must* reconstruct the request.
    // This is because Elysia's body parser consumes the original request body stream.
    // By creating a new Request with the already-parsed `ctx.body`, we provide
    // tRPC's `resolveResponse` with a new, readable stream.
    const request = new Request(ctx.request.url, {
      method: ctx.request.method,
      headers: ctx.request.headers,
      body: JSON.stringify(ctx.body),
    });

    return resolveResponse({
      router: opts.router,
      req: request,
      path,
      // --- FIX: Remove `async` and use `Promise.resolve` to satisfy the linter ---
      createContext: () => Promise.resolve(trpcContext),
      error: null,
    });
  };
};
