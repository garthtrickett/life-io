// File: ./elysia/routes.ts
import { Elysia } from "elysia";
import { Data, Effect, Fiber, Stream } from "effect";
import { staticPlugin } from "@elysiajs/static";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { PushRequest } from "replicache";
import { existsSync, readFileSync } from "node:fs";

import { PokeService } from "../lib/server/PokeService";
import { appRouter } from "../trpc/router";
import { createContext } from "../trpc/context";
import {
  handlePull,
  handlePush,
  type PullRequest as ReplicachePullRequest,
} from "../replicache/server";
import { handleAvatarUpload, handleClientLog } from "./handlers";
import { authenticateRequestEffect } from "./auth";
import { ApiError, InvalidPullRequestError } from "./errors";
import { runServerUnscoped } from "../lib/server/runtime";
import { serverLog } from "../lib/server/logger.server";
import { effectHandler } from "./effectHandler";

type WsSender = { id: string; send: (message: string) => void };

/**
 * An Effect that creates and configures the Elysia application instance.
 */
export const makeApp = Effect.gen(function* () {
  const app = new Elysia();
  const isProduction = process.env.NODE_ENV === "production";
  const pokeService = yield* PokeService;
  const wsConnections = new Map<string, Fiber.RuntimeFiber<void, unknown>>();

  // A helper function to map any non-tagged error to our new ApiError
  const mapToApiError = (error: unknown) => {
    if (error instanceof Data.TaggedError) {
      return error; // It's already tagged, pass it through.
    }
    if (error instanceof Error) {
      return new ApiError({ message: error.message, cause: error });
    }
    return new ApiError({
      message: "An unknown error occurred",
      cause: error,
    });
  };

  // --- tRPC Endpoints ---
  const handleTrpc = (context: { request: Request }) =>
    fetchRequestHandler({
      endpoint: "/trpc",
      router: appRouter,
      req: context.request,
      createContext,
    });
  app.get("/trpc/*", handleTrpc).post("/trpc/*", handleTrpc);

  app.group("/replicache", (group) =>
    group
      .post("/pull", ({ request, body }) => {
        const pullProgram = Effect.gen(function* () {
          const user = yield* authenticateRequestEffect(request);
          const pull = body as ReplicachePullRequest;

          if (!("clientGroupID" in pull)) {
            return yield* Effect.fail(
              new InvalidPullRequestError({
                message: "Unsupported pull request version.",
              }),
            );
          }
          // All errors from this point forward are handled by the pipe below
          return yield* handlePull(user.id, pull);
        }).pipe(
          // A single `mapError` catches all errors from the chain and ensures they are tagged.
          Effect.mapError(mapToApiError),
        );

        return effectHandler(pullProgram);
      })
      .post("/push", ({ request, body }) => {
        const pushProgram = Effect.gen(function* () {
          const user = yield* authenticateRequestEffect(request);
          // All errors from this point forward are handled by the pipe below
          yield* handlePush(body as PushRequest, user.id);
          return { success: true };
        }).pipe(
          // A single `mapError` catches all errors from the chain and ensures they are tagged.
          Effect.mapError(mapToApiError),
        );

        return effectHandler(pushProgram);
      }),
  );

  // --- WebSocket for Replicache Pokes ---
  app.ws("/ws", {
    open(ws: WsSender) {
      const streamFiber = Effect.runFork(
        Effect.scoped(
          pokeService
            .subscribe()
            .pipe(
              Stream.runForEach((message: string) =>
                Effect.sync(() => void ws.send(message)),
              ),
            ),
        ),
      );
      wsConnections.set(ws.id, streamFiber);
      runServerUnscoped(
        serverLog("info", `WebSocket connected: ${ws.id}`, undefined, "WS"),
      );
    },
    close(ws: WsSender) {
      const streamFiber = wsConnections.get(ws.id);
      if (streamFiber) {
        Effect.runFork(Fiber.interrupt(streamFiber));
        wsConnections.delete(ws.id);
      }
      runServerUnscoped(
        serverLog("info", `WebSocket disconnected: ${ws.id}`, undefined, "WS"),
      );
    },
  });
  // --- Other API Endpoints ---
  app
    .post("/api/user/avatar", (context) =>
      effectHandler(
        handleAvatarUpload(context).pipe(
          Effect.catchTags({
            // Errors from this specific handler are mapped to a failure in the effect handler's context
            FileError: (e) =>
              Effect.succeed(new Response(e.message, { status: 400 })),
            S3UploadError: () =>
              Effect.succeed(
                new Response("S3 upload failed.", { status: 500 }),
              ),
            DbUpdateError: () =>
              Effect.succeed(
                new Response("Database update failed.", { status: 500 }),
              ),
          }),
        ),
      ),
    )
    .post("/log/client", ({ body }) =>
      effectHandler(
        handleClientLog(body).pipe(
          Effect.catchTag("FileError", (e) =>
            Effect.succeed(new Response(e.message, { status: 400 })),
          ),
        ),
      ),
    );
  // --- Static File Serving & SPA Fallback (Production) ---
  if (isProduction) {
    yield* Effect.forkDaemon(
      serverLog("info", "Production mode: Setting up static file serving."),
    );
    const publicDir = "dist/public";
    const indexHtmlPath = `${publicDir}/index.html`;

    if (existsSync(indexHtmlPath)) {
      const indexHtml = readFileSync(indexHtmlPath, "utf-8");
      app.use(staticPlugin({ assets: publicDir, prefix: "" }));
      app.get(
        "*",
        () =>
          new Response(indexHtml, { headers: { "Content-Type": "text/html" } }),
      );
    } else {
      const errorMessage = `[Production Error] Frontend build not found at: ${indexHtmlPath}.`;
      return yield* Effect.fail(new Error(errorMessage));
    }
  } else {
    yield* Effect.forkDaemon(
      serverLog("info", "Development mode. Vite will serve static files."),
    );
  }

  return app;
});
