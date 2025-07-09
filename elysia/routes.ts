// File: elysia/routes.ts

import { Elysia, t } from "elysia";
import { Effect, Fiber, Stream } from "effect";
import { staticPlugin } from "@elysiajs/static";
import type { PushRequest } from "replicache";
import { existsSync, readFileSync } from "node:fs";

import { PokeService } from "../lib/server/PokeService";
import { appRouter } from "../trpc/router";
import { createContext } from "../trpc/context";
import { createElysiaTrpcAdapter } from "./trpcAdapter";
import {
  handlePull,
  handlePush,
  type PullRequest as ReplicachePullRequest,
} from "../replicache/server";
import { handleAvatarUpload } from "./handlers";
import { authenticateRequestEffect } from "./auth";
import { runServerUnscoped } from "../lib/server/runtime";
import { serverLog } from "../lib/server/logger.server";
import { effectHandler } from "./effectHandler";
import { validateSessionEffect } from "../lib/server/auth";
import { ip } from "elysia-ip";

export const makeApp = Effect.gen(function* () {
  const isProduction = process.env.NODE_ENV === "production";
  const pokeService = yield* PokeService;
  const wsConnections = new Map<string, Fiber.RuntimeFiber<void, unknown>>();

  const trpcHandler = createElysiaTrpcAdapter({
    router: appRouter,
    createContext,
  });

  const app = new Elysia()
    .group("/api", (group) =>
      group
        // By removing the explicit `: ElysiaHandlerContext` type from `ctx`,
        // we allow TypeScript to correctly infer the fully decorated context
        // provided by Elysia, which includes the `ip` property.
        .use(ip())
        .all("/trpc/*", (ctx) => trpcHandler(ctx), {
          query: t.Object({
            batch: t.Optional(t.String()),
            input: t.Optional(t.String()),
          }),
        })
        .post("/replicache/pull", (ctx) =>
          effectHandler(
            Effect.gen(function* () {
              const user = yield* authenticateRequestEffect(ctx.request);
              return yield* handlePull(
                user.id,
                ctx.body as ReplicachePullRequest,
              );
            }),
          )(),
        )
        .post("/replicache/push", (ctx) =>
          effectHandler(
            Effect.gen(function* () {
              const user = yield* authenticateRequestEffect(ctx.request);
              yield* handlePush(ctx.body as PushRequest, user.id);
              return { ok: true };
            }),
          )(),
        )
        .post(
          "/user/avatar",
          (ctx) => effectHandler(handleAvatarUpload(ctx))(),
          { body: t.Object({ avatar: t.File() }) },
        ),
    )
    .ws("/ws", {
      query: t.Object({
        sessionId: t.Optional(t.String()),
      }),
      open(ws) {
        runServerUnscoped(
          Effect.gen(function* () {
            const sessionId = ws.data.query.sessionId;
            if (!sessionId) {
              yield* serverLog(
                "warn",
                `WS Connection ${String(
                  ws.id,
                )} closed: No session ID provided.`,
              );
              ws.send(JSON.stringify({ error: "authentication_failed" }));
              return ws.close();
            }

            const { user } = yield* validateSessionEffect(sessionId).pipe(
              Effect.catchAll((e) => {
                return serverLog(
                  "warn",
                  `WS Auth failed for session ${sessionId}: ${e._tag}`,
                ).pipe(Effect.andThen(Effect.fail(e)));
              }),
            );
            if (!user) {
              yield* serverLog(
                "warn",
                `WS Connection ${String(ws.id)} closed: Invalid session.`,
              );
              ws.send(JSON.stringify({ error: "authentication_failed" }));
              return ws.close();
            }

            yield* serverLog(
              "info",
              `WebSocket opened and authenticated for user ${
                user.id
              } (conn: ${String(ws.id)}). Subscribing to poke service.`,
              user.id,
              "WS:Lifecycle",
            );
            const streamProcessingEffect = pokeService
              .subscribe(user.id)
              .pipe(
                Stream.runForEach((msg) =>
                  serverLog(
                    "info",
                    `Sending poke message "${msg}" to client: ${String(ws.id)}`,
                    user.id,
                    "WS:PokeSend",
                  ).pipe(Effect.andThen(Effect.sync(() => ws.send(msg)))),
                ),
              );

            const fiber = runServerUnscoped(streamProcessingEffect);
            wsConnections.set(String(ws.id), fiber);
          }),
        );
      },
      close(ws) {
        runServerUnscoped(
          serverLog(
            "info",
            `WebSocket closed: ${String(
              ws.id,
            )}. Interrupting subscription fiber.`,
            undefined,
            "WS:Lifecycle",
          ),
        );
        const fiber = wsConnections.get(String(ws.id));
        if (fiber) {
          Effect.runFork(Fiber.interrupt(fiber));
          wsConnections.delete(String(ws.id));
        }
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
