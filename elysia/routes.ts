// FILE: elysia/routes.ts
import { Elysia, t } from "elysia";
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

  const app = new Elysia()
    /* ---------- API ---------- */
    .group("/api", (group) =>
      group
        /* tRPC */
        .all("/trpc/*", ({ request }) =>
          fetchRequestHandler({
            endpoint: "/api/trpc",
            router: appRouter,
            req: request,
            createContext,
          }),
        )

        .post(
          "/replicache/pull",
          (ctx) =>
            effectHandler(
              Effect.gen(function* () {
                const user = yield* authenticateRequestEffect(ctx.request);
                return yield* handlePull(
                  user.id,
                  ctx.body as ReplicachePullRequest,
                );
              }).pipe(Effect.mapError(mapToApiError)),
            )(), //  ← CALL IT
        )

        .post(
          "/replicache/push",
          (ctx) =>
            effectHandler(
              Effect.gen(function* () {
                const user = yield* authenticateRequestEffect(ctx.request);
                yield* handlePush(ctx.body as PushRequest, user.id);
                return { ok: true }; // Replicache expects this
              }).pipe(Effect.mapError(mapToApiError)),
            )(), //  ← CALL IT
        )

        .post(
          "/user/avatar",
          (ctx) => effectHandler(handleAvatarUpload(ctx))(), // ← CALL IT
          { body: t.Object({ avatar: t.File() }) },
        ),
    )

    /* ---------- WebSocket ---------- */
    .ws("/ws", {
      open(ws: WsSender) {
        const fiber = Effect.runFork(
          Effect.scoped(
            pokeService
              .subscribe()
              .pipe(
                Stream.runForEach((msg: string) =>
                  Effect.sync(() => void ws.send(msg)),
                ),
              ),
          ),
        );
        wsConnections.set(ws.id, fiber);
        runServerUnscoped(
          serverLog("info", `WebSocket connected: ${ws.id}`, undefined, "WS"),
        );
      },
      close(ws: WsSender) {
        const fiber = wsConnections.get(ws.id);
        if (fiber) {
          Effect.runFork(Fiber.interrupt(fiber));
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

  /* ---------- Static files ---------- */
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
      return yield* Effect.fail(
        new Error(
          `[Production Error] Frontend build not found at: ${indexHtmlPath}.`,
        ),
      );
    }
  } else {
    yield* Effect.forkDaemon(
      serverLog("info", "Development mode. Vite will serve static files."),
    );
  }

  return app;
});
