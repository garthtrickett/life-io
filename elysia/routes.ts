// File: ./elysia/routes.ts
import { Elysia } from "elysia";
import { Effect, Fiber, Stream, pipe } from "effect";
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
import { AuthError, InvalidPullRequestError } from "./errors";
import { runServerPromise, runServerUnscoped } from "../lib/server/runtime";
import { serverLog } from "../lib/server/logger.server";

type WsSender = { id: string; send: (message: string) => void };

/**
 * An Effect that creates and configures the Elysia application instance.
 */
export const makeApp = Effect.gen(function* () {
  const app = new Elysia();
  const isProduction = process.env.NODE_ENV === "production";
  const pokeService = yield* PokeService;
  const wsConnections = new Map<string, Fiber.RuntimeFiber<void, unknown>>();

  // --- tRPC Endpoints ---
  const handleTrpc = (context: { request: Request }) =>
    fetchRequestHandler({
      endpoint: "/trpc",
      router: appRouter,
      req: context.request,
      createContext,
    });
  app.get("/trpc/*", handleTrpc).post("/trpc/*", handleTrpc);

  // --- Replicache Endpoints ---
  app.group("/replicache", (group) =>
    group
      .post("/pull", async ({ request, body }) => {
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
          return yield* handlePull(user.id, pull);
        });

        const handledProgram = Effect.matchEffect(pullProgram, {
          onFailure: (error) => {
            if (error instanceof AuthError) {
              return Effect.succeed(
                new Response(error.message, { status: 401 }),
              );
            }
            if (error instanceof InvalidPullRequestError) {
              return Effect.succeed(
                new Response(error.message, { status: 400 }),
              );
            }
            return pipe(
              serverLog(
                "error",
                `Unhandled error in /replicache/pull: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              ),
              Effect.andThen(
                Effect.succeed(
                  new Response("Internal Server Error", { status: 500 }),
                ),
              ),
            );
          },
          onSuccess: (pullResponse) => Effect.succeed(pullResponse),
        });

        return runServerPromise(handledProgram);
      })
      .post("/push", ({ request, body }) => {
        const pushProgram = Effect.gen(function* () {
          const user = yield* authenticateRequestEffect(request);
          yield* handlePush(body as PushRequest, user.id);
          return { success: true };
        });

        const handledProgram = Effect.matchEffect(pushProgram, {
          onFailure: (error) => {
            if (error instanceof AuthError) {
              return Effect.succeed(
                new Response(error.message, { status: 401 }),
              );
            }
            return pipe(
              serverLog(
                "error",
                `Unhandled error in /replicache/push: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              ),
              Effect.andThen(
                Effect.succeed(
                  new Response("Internal Server Error", { status: 500 }),
                ),
              ),
            );
          },
          onSuccess: (result) => Effect.succeed(result),
        });

        return runServerPromise(handledProgram);
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
      runServerPromise(
        handleAvatarUpload(context).pipe(
          Effect.catchTags({
            AuthError: (e) =>
              Effect.succeed(new Response(e.message, { status: 401 })),
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
      runServerPromise(
        handleClientLog(body).pipe(
          Effect.catchTags({
            FileError: (e) =>
              Effect.succeed(new Response(e.message, { status: 400 })),
          }),
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
