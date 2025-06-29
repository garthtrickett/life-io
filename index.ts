// FILE: index.ts
import { existsSync, readFileSync } from "node:fs";
import { staticPlugin } from "@elysiajs/static";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Cause, Effect, Exit } from "effect";
import { Elysia, t } from "elysia";

import { serverLog } from "./lib/server/logger.server";
import { runServerEffect } from "./lib/server/runtime";
import { createContext } from "./trpc/context";
import { appRouter } from "./trpc/router";

type ServerLoggableLevel = "info" | "error" | "warn" | "debug";

const isLoggableLevel = (level: string): level is ServerLoggableLevel => {
  return ["info", "error", "warn", "debug"].includes(level);
};

const setupApp = Effect.gen(function* () {
  const app = new Elysia();
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction) {
    yield* serverLog(
      "info",
      "Production mode detected. Setting up static file serving.",
    );
    const publicDir = "./dist/public";
    const indexHtmlPath = `${publicDir}/index.html`;

    const buildExists = yield* Effect.sync(() => existsSync(indexHtmlPath));

    if (buildExists) {
      yield* serverLog("info", `Serving static files from ${publicDir}`);

      const indexHtml = yield* Effect.sync(() =>
        readFileSync(indexHtmlPath, "utf-8"),
      );

      app
        .use(staticPlugin({ assets: publicDir, prefix: "/" }))
        .get("*", () => indexHtml);
    } else {
      const errorMessage = `[Production Mode Error] Frontend build not found!
      - Looked for 'index.html' at: ${indexHtmlPath}
      - This server is running in production mode (NODE_ENV=production).
      - It requires the frontend to be built first.

      Please run 'bun run build' before starting the production server with 'bun run start'.`;

      return yield* Effect.fail(new Error(errorMessage));
    }
  } else {
    yield* serverLog(
      "info",
      "Development mode detected. Adding client log endpoint.",
    );
    app.post(
      "/log/client",
      ({ body }) => {
        const { level: levelFromClient, args } = body;

        if (isLoggableLevel(levelFromClient)) {
          // FIX: Explicitly ignore the promise for this fire-and-forget log effect.
          void runServerEffect(
            serverLog(
              levelFromClient,
              `[CLIENT] ${args.join(" ")}`,
              undefined,
              "Client",
            ),
          );
        } else {
          console.warn(
            `[SERVER] Received unknown log level from client: ${levelFromClient}`,
          );
        }

        return new Response(null, { status: 204 });
      },
      {
        body: t.Object({
          level: t.String(),
          args: t.Array(t.Any()),
        }),
      },
    );
  }

  app.all("/trpc/*", async (opts) => {
    return fetchRequestHandler({
      endpoint: "/trpc",
      router: appRouter,
      req: opts.request,
      createContext,
    });
  });

  return app;
});

// FIX: Ignore the top-level promise chain. The .then() call itself returns a
// promise that was unhandled. Using `void` signals to the linter that this is intentional.
void Effect.runPromiseExit(setupApp).then((exit) => {
  if (Exit.isSuccess(exit)) {
    const app = exit.value;
    app.listen(42069, () => {
      // FIX: Explicitly ignore the promise for this fire-and-forget log effect.
      void runServerEffect(
        serverLog(
          "info",
          `🦊 Elysia server with tRPC listening on http://localhost:42069`,
          undefined,
          "Startup",
        ),
      );
    });
  } else {
    console.error("\n❌ Server setup failed. Details below:\n");
    console.error(Cause.pretty(exit.cause));
    process.exit(1);
  }
});
