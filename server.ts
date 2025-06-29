// File: ./server.ts

import { existsSync, readFileSync } from "node:fs";
import { staticPlugin } from "@elysiajs/static";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Cause, Effect, Exit } from "effect";
import { Elysia, t } from "elysia";

import { s3 } from "./lib/server/s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { randomBytes } from "node:crypto";
import { db } from "./db/kysely";
import { validateSession } from "./lib/server/auth";

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

  // --- 1. API ROUTES (Registered in all environments) ---

  // Handle tRPC requests
  app.all("/trpc/*", async (opts) => {
    return fetchRequestHandler({
      endpoint: "/trpc",
      router: appRouter,
      req: opts.request,
      createContext,
    });
  });

  // Handle file uploads
  app.post(
    "/api/user/avatar",
    async (context) => {
      // ... (authentication and upload logic remains the same)
      const cookieHeader = context.request.headers.get("Cookie") ?? "";
      const sessionId = cookieHeader
        .split(";")
        .find((c) => c.trim().startsWith("session_id="))
        ?.split("=")[1];

      if (!sessionId) {
        return new Response("Unauthorized", { status: 401 });
      }
      const { user } = await validateSession(sessionId);
      if (!user) {
        return new Response("Unauthorized", { status: 401 });
      }

      const { avatar } = context.body;
      if (!avatar || !(avatar instanceof Blob)) {
        return new Response(
          "Bad Request: 'avatar' field is missing or not a file.",
          { status: 400 },
        );
      }

      const bucketName = process.env.BUCKET_NAME!;
      const fileExtension = avatar.type.split("/")[1] || "jpg";
      const randomId = randomBytes(16).toString("hex");
      const key = `avatars/${user.id}/${Date.now()}-${randomId}.${fileExtension}`;

      try {
        const uploadCommand = new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: Buffer.from(await avatar.arrayBuffer()),
          ContentType: avatar.type,
        });
        await s3.send(uploadCommand);
      } catch (e) {
        runServerEffect(
          serverLog(
            "error",
            `Failed to upload avatar to S3 for user ${user.id}: ${String(e)}`,
          ),
        );
        return new Response("Internal Server Error", { status: 500 });
      }

      const publicUrlBase = process.env.PUBLIC_AVATAR_URL!;
      const avatarUrl = `${publicUrlBase}/${key}`;

      await db
        .updateTable("user")
        .set({ avatar_url: avatarUrl })
        .where("id", "=", user.id)
        .execute();

      return { avatarUrl };
    },
    {
      body: t.Object({
        avatar: t.File({
          maxSize: "5m",
          type: ["image/jpeg", "image/png", "image/webp"],
        }),
      }),
    },
  );

  // Handle client-side logging
  app.post(
    "/log/client",
    ({ body }) => {
      const { level: levelFromClient, args } = body;
      if (isLoggableLevel(levelFromClient)) {
        void runServerEffect(
          serverLog(
            levelFromClient,
            `[CLIENT] ${args.join(" ")}`,
            undefined,
            "Client",
          ),
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

  // --- 2. STATIC FILE & SPA FALLBACK (Production-only) ---

  if (isProduction) {
    yield* serverLog(
      "info",
      "Production mode detected. Setting up static file serving and SPA fallback.",
    );
    const publicDir = "dist/public";
    const indexHtmlPath = `${publicDir}/index.html`;

    const buildExists = yield* Effect.sync(() => existsSync(indexHtmlPath));

    if (buildExists) {
      const indexHtml = yield* Effect.sync(() =>
        readFileSync(indexHtmlPath, "utf-8"),
      );
      yield* serverLog("info", `Serving static files from ${publicDir}`);
      // This MUST come after all API routes.
      app
        .use(
          staticPlugin({
            assets: publicDir,
            prefix: "",
          }),
        )
        .get("*", () => indexHtml); // SPA fallback for GET requests
    } else {
      const errorMessage = `[Production Mode Error] Frontend build not found!
      - Looked for 'index.html' at: ${indexHtmlPath}
      Please run 'bun run build' before starting the production server.`;
      return yield* Effect.fail(new Error(errorMessage));
    }
  } else {
    yield* serverLog(
      "info",
      "Development mode. API routes are set up; Vite will handle static file serving.",
    );
  }

  return app;
});

void Effect.runPromiseExit(setupApp).then((exit) => {
  if (Exit.isSuccess(exit)) {
    const app = exit.value;
    app.listen(42069, () => {
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
