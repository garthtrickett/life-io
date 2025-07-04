// FILE: elysia/routes.ts
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
import { handleAvatarUpload } from "./handlers";
import { authenticateRequestEffect } from "./auth";
import { ApiError } from "./errors";
import { runServerUnscoped } from "../lib/server/runtime";
import { serverLog } from "../lib/server/logger.server";
import { effectHandler } from "./effectHandler";

type WsSender = { id: string; send: (message: string) => void };

/**
 * An Effect that creates and configures the Elysia application instance.
 */
export const makeApp = Effect.gen(function* () {
  const isProduction = process.env.NODE_ENV === "production";
  const pokeService = yield* PokeService;
  const wsConnections = new Map<string, Fiber.RuntimeFiber<void, unknown>>();

  const mapToApiError = (error: unknown) => {
    if (error instanceof Data.TaggedError) return error;
    if (error instanceof Error)
      return new ApiError({ message: error.message, cause: error });
    return new ApiError({ message: "An unknown error occurred", cause: error });
  };

  const apiRoutes = new Elysia()
    .group("/trpc", (group) =>
      group.all("/*", ({ request }) =>
        fetchRequestHandler({
          endpoint: "/api/trpc",
          router: appRouter,
          req: request,
          createContext,
        }),
      ),
    )
    .group("/replicache", (group) =>
      group
        .post("/pull", ({ request, body }) =>
          effectHandler(
            Effect.gen(function* () {
              const user = yield* authenticateRequestEffect(request);
              return yield* handlePull(user.id, body as ReplicachePullRequest);
            }).pipe(Effect.mapError(mapToApiError)),
          ),
        )
        .post("/push", ({ request, body }) =>
          effectHandler(
            Effect.gen(function* () {
              const user = yield* authenticateRequestEffect(request);
              yield* handlePush(body as PushRequest, user.id);
              return { success: true };
            }).pipe(Effect.mapError(mapToApiError)),
          ),
        ),
    )
    .post("/user/avatar", (context) =>
      effectHandler(handleAvatarUpload(context)),
    );

  const app = new Elysia()
    .group("/api", (group) => group.use(apiRoutes))
    .ws("/ws", {
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
          serverLog(
            "info",
            `WebSocket disconnected: ${ws.id}`,
            undefined,
            "WS",
          ),
        );
      },
    });

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
