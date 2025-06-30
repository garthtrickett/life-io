// File: ./server.ts
// --- FIX START ---
import { existsSync, readFileSync } from "node:fs";
import { staticPlugin } from "@elysiajs/static";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Cause, Effect, Exit, Option } from "effect";
import { Elysia, t } from "elysia";

import { s3 } from "./lib/server/s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { randomBytes } from "node:crypto";
import { db } from "./db/kysely";
import { validateSessionEffect } from "./lib/server/auth";

import { serverLog } from "./lib/server/logger.server";
import { runServerPromise, runServerUnscoped } from "./lib/server/runtime";
import { createContext } from "./trpc/context";
import { appRouter } from "./trpc/router";

type ServerLoggableLevel = "info" | "error" | "warn" | "debug";

const isLoggableLevel = (level: string): level is ServerLoggableLevel => {
  return ["info", "error", "warn", "debug"].includes(level);
};

// --- Effect for logging client-side messages ---
const logClientMessageEffect = (body: { level: string; args: unknown[] }) =>
  Effect.gen(function* () {
    const { level: levelFromClient, args } = body;
    if (isLoggableLevel(levelFromClient)) {
      yield* Effect.forkDaemon(
        serverLog(
          levelFromClient,
          `[CLIENT] ${args.join(" ")}`,
          undefined,
          "Client",
        ),
      );
    }
    return new Response(null, { status: 204 });
  });

// --- Effect for handling avatar uploads ---
const avatarUploadEffect = (context: {
  request: Request;
  body: { avatar?: File };
}) =>
  Effect.gen(function* () {
    yield* Effect.forkDaemon(
      serverLog(
        "info",
        "Avatar upload request received.",
        undefined,
        "AvatarUpload",
      ),
    );

    const cookieHeader = context.request.headers.get("Cookie") ?? "";
    const sessionId = Option.fromNullable(
      cookieHeader
        .split(";")
        .find((c) => c.trim().startsWith("session_id="))
        ?.split("=")[1],
    );

    if (Option.isNone(sessionId)) {
      yield* Effect.forkDaemon(
        serverLog(
          "warn",
          "Avatar upload rejected: No session ID found.",
          undefined,
          "AvatarUpload",
        ),
      );
      return new Response("Unauthorized", { status: 401 });
    }

    const { user } = yield* validateSessionEffect(sessionId.value);
    if (!user) {
      yield* Effect.forkDaemon(
        serverLog(
          "warn",
          "Avatar upload rejected: Invalid session.",
          undefined,
          "AvatarUpload",
        ),
      );
      return new Response("Unauthorized", { status: 401 });
    }

    yield* Effect.forkDaemon(
      serverLog(
        "info",
        `User authenticated for avatar upload.`,
        user.id,
        "AvatarUpload",
      ),
    );

    const { avatar } = context.body;
    if (!avatar || !(avatar instanceof Blob)) {
      yield* Effect.forkDaemon(
        serverLog(
          "error",
          "Bad request for avatar upload: 'avatar' field missing or not a file.",
          user.id,
          "AvatarUpload",
        ),
      );
      return new Response(
        "Bad Request: 'avatar' field is missing or not a file.",
        { status: 400 },
      );
    }

    const bucketName = process.env.BUCKET_NAME!;
    const fileExtension = avatar.type.split("/")[1] || "jpg";
    const randomId = randomBytes(16).toString("hex");
    const key = `avatars/${user.id}/${Date.now()}-${randomId}.${fileExtension}`;

    const buffer = yield* Effect.tryPromise({
      try: () => avatar.arrayBuffer(),
      catch: (e) => new Error(`Failed to read avatar file: ${String(e)}`),
    });

    yield* Effect.tryPromise({
      try: () =>
        s3.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            Body: Buffer.from(buffer),
            ContentType: avatar.type,
          }),
        ),
      catch: (e) => new Error(`S3 Upload Failed: ${String(e)}`),
    }).pipe(
      Effect.tap(() =>
        Effect.forkDaemon(
          serverLog(
            "info",
            `Successfully uploaded avatar to S3: ${key}`,
            user.id,
            "AvatarUpload:S3",
          ),
        ),
      ),
      Effect.tapError((e) =>
        Effect.forkDaemon(
          serverLog(
            "error",
            `Failed to upload avatar to S3 for user ${user.id}: ${e.message}`,
            user.id,
            "AvatarUpload:S3",
          ),
        ),
      ),
    );
    const publicUrlBase = process.env.PUBLIC_AVATAR_URL!;
    const avatarUrl = `${publicUrlBase}/${key}`;

    yield* Effect.tryPromise({
      try: () =>
        db
          .updateTable("user")
          .set({ avatar_url: avatarUrl })
          .where("id", "=", user.id)
          .execute(),
      catch: (e) => new Error(`DB update failed: ${String(e)}`),
    });

    yield* Effect.forkDaemon(
      serverLog(
        "info",
        `Updated user avatar URL in DB: ${avatarUrl}`,
        user.id,
        "AvatarUpload:DB",
      ),
    );
    return { avatarUrl };
  }).pipe(
    Effect.catchAll((error) =>
      Effect.succeed(
        new Response(`Internal Server Error: ${error.message}`, {
          status: 500,
        }),
      ),
    ),
  );

// --- Main application setup Effect ---
const setupApp = Effect.gen(function* () {
  const app = new Elysia();
  const isProduction = process.env.NODE_ENV === "production";

  const handleTrpc = (context: { request: Request }) =>
    fetchRequestHandler({
      endpoint: "/trpc",
      router: appRouter,
      req: context.request,
      createContext,
    });

  app.get("/trpc/*", handleTrpc);
  app.post("/trpc/*", handleTrpc);

  app.post(
    "/api/user/avatar",
    (context) => runServerPromise(avatarUploadEffect(context)),
    {
      body: t.Object({
        avatar: t.File({
          maxSize: "5m",
          type: ["image/jpeg", "image/png", "image/webp"],
        }),
      }),
    },
  );

  app.post(
    "/log/client",
    ({ body }) => runServerPromise(logClientMessageEffect(body)),
    {
      body: t.Object({
        level: t.String(),
        args: t.Array(t.Any()),
      }),
    },
  );

  if (isProduction) {
    yield* Effect.forkDaemon(
      serverLog(
        "info",
        "Production mode detected. Setting up static file serving and SPA fallback.",
      ),
    );
    const publicDir = "dist/public";
    const indexHtmlPath = `${publicDir}/index.html`;

    const buildExists = yield* Effect.sync(() => existsSync(indexHtmlPath));
    if (buildExists) {
      const indexHtml = yield* Effect.sync(() =>
        readFileSync(indexHtmlPath, "utf-8"),
      );
      yield* Effect.forkDaemon(
        serverLog("info", `Serving static files from ${publicDir}`),
      );

      app.use(staticPlugin({ assets: publicDir, prefix: "" }));
      app.get(
        "*",
        () =>
          new Response(indexHtml, { headers: { "Content-Type": "text/html" } }),
      );
    } else {
      const errorMessage = `[Production Mode Error] Frontend build not found! Looked for 'index.html' at: ${indexHtmlPath}. Please run 'bun run build' before starting the production server.`;
      return yield* Effect.fail(new Error(errorMessage));
    }
  } else {
    yield* Effect.forkDaemon(
      serverLog(
        "info",
        "Development mode. API routes are set up; Vite will handle static file serving.",
      ),
    );
  }

  return app;
});

void Effect.runPromiseExit(setupApp).then((exit) => {
  if (Exit.isSuccess(exit)) {
    const app = exit.value;
    const server = app.listen(42069, () => {
      runServerUnscoped(
        serverLog(
          "info",
          `🦊 Elysia server with tRPC listening on http://localhost:42069`,
          undefined,
          "Startup",
        ),
      );
    });

    const gracefulShutdown = async (signal: string) => {
      console.info(`\nReceived ${signal}. Shutting down gracefully...`);
      await server.stop();
      await runServerPromise(
        serverLog("info", "Closing database connections before exit."),
      );
      await db.destroy();
      console.info("Database connections closed.");
      process.exit(0);
    };

    process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
    process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
  } else {
    console.error("\n❌ Server setup failed. Details below:\n");
    console.error(Cause.pretty(exit.cause));
    process.exit(1);
  }
});
// --- FIX END ---
