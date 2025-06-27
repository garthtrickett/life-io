// FILE: index.ts
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Elysia, t } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { appRouter } from "./trpc/router";
import { Effect, Exit, Cause } from "effect";
import { readFileSync, existsSync } from "node:fs";
import { serverLog } from "./lib/server/logger.server";
import { createContext } from "./trpc/context";

// Define the type for log levels that can be received and processed by the server
type ServerLoggableLevel = "info" | "error" | "warn" | "debug";

// --- Type Guard Helper Function ---
const isLoggableLevel = (level: string): level is ServerLoggableLevel => {
  return ["info", "error", "warn", "debug"].includes(level);
};

/**
 * Creates and configures the Elysia app within an Effect.
 */
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
          Effect.runPromise(
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
    const res = await fetchRequestHandler({
      endpoint: "/trpc",
      router: appRouter,
      req: opts.request,
      createContext,
    });

    return res;
  });

  return app;
});

// --- Program Runner ---
Effect.runPromiseExit(setupApp).then((exit) => {
  if (Exit.isSuccess(exit)) {
    const app = exit.value;
    app.listen(42069, () => {
      Effect.runPromise(
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
