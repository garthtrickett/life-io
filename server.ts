// File: ./server.ts
import { existsSync, readFileSync } from "node:fs";
import { staticPlugin } from "@elysiajs/static";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import {
  Cause,
  Data,
  Effect,
  Exit,
  Option,
  Schedule,
  pipe,
  Duration,
  Fiber,
  Stream,
  PubSub,
} from "effect";
import { Elysia } from "elysia";
import type { PushRequest } from "replicache";
import { handlePull, handlePush } from "./replicache/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { validateSessionEffect } from "./lib/server/auth";
import { serverLog } from "./lib/server/logger.server";
import {
  runServerPromise,
  runServerUnscoped,
  ServerLive,
} from "./lib/server/runtime";
import { createContext } from "./trpc/context";
import { appRouter } from "./trpc/router";
import { S3 } from "./lib/server/s3";
import { generateId } from "./lib/server/utils";
import { Schema } from "@effect/schema";
import { formatErrorSync } from "@effect/schema/TreeFormatter";
import { Db } from "./db/DbTag";
import {
  cleanupExpiredTokensEffect,
  retryFailedEmailsEffect,
} from "./lib/server/jobs";
import type { UserId } from "./types/generated/public/User";

// --- Custom Error Types for Avatar Upload ---
class AuthError extends Data.TaggedError("AuthError")<{ message: string }> {}
class FileError extends Data.TaggedError("FileError")<{ message: string }> {}
class S3UploadError extends Data.TaggedError("S3UploadError")<{
  cause: unknown;
}> {}
class DbUpdateError extends Data.TaggedError("DbUpdateError")<{
  cause: unknown;
}> {}

// --- Body Schemas with Effect Schema ---
const AvatarUploadBody = Schema.Struct({
  avatar: Schema.instanceOf(File).pipe(
    Schema.filter((file) => file.size <= 5 * 1024 * 1024, {
      message: () => `File size must not exceed 5MB.`,
    }),
    Schema.filter(
      (file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type),
      {
        message: () =>
          `File type must be one of: image/jpeg, image/png, image/webp.`,
      },
    ),
  ),
});
const ClientLogBody = Schema.Struct({
  level: Schema.String,
  args: Schema.Array(Schema.Any),
});

type ServerLoggableLevel = "info" | "error" | "warn" | "debug";
const isLoggableLevel = (level: string): level is ServerLoggableLevel => {
  return ["info", "error", "warn", "debug"].includes(level);
};
const logClientMessageEffect = (body: unknown) =>
  Effect.gen(function* () {
    const { level: levelFromClient, args } = yield* Schema.decodeUnknown(
      ClientLogBody,
    )(body).pipe(
      Effect.mapError((e) => new FileError({ message: formatErrorSync(e) })),
    );

    if (isLoggableLevel(levelFromClient)) {
      // FIX: Safely convert any[] to a string for logging.
      const message = Array.isArray(args)
        ? args.map(String).join(" ")
        : String(args);

      yield* Effect.forkDaemon(
        serverLog(levelFromClient, `[CLIENT] ${message}`, undefined, "Client"),
      );
    }
    return new Response(null, { status: 204 });
  });
const avatarUploadEffect = (context: { request: Request; body: unknown }) =>
  Effect.gen(function* () {
    yield* serverLog(
      "info",
      "Avatar upload request received.",
      undefined,
      "AvatarUpload",
    );
    const s3 = yield* S3;
    const db = yield* Db;

    const decodedBody = yield* Schema.decodeUnknown(AvatarUploadBody)(
      context.body,
    ).pipe(
      Effect.mapError((e) => new FileError({ message: formatErrorSync(e) })),
    );
    const { avatar } = decodedBody;

    const cookieHeader = context.request.headers.get("Cookie") ?? "";
    const sessionIdOption = Option.fromNullable(
      cookieHeader
        .split(";")
        .find((c) => c.trim().startsWith("session_id="))
        ?.split("=")[1],
    );

    if (Option.isNone(sessionIdOption)) {
      return yield* Effect.fail(
        new AuthError({ message: "Unauthorized: No session ID found." }),
      );
    }

    const { user } = yield* validateSessionEffect(sessionIdOption.value).pipe(
      Effect.mapError(
        () => new AuthError({ message: "Session validation failed." }),
      ),
    );
    if (!user) {
      return yield* Effect.fail(
        new AuthError({ message: "Unauthorized: Invalid session." }),
      );
    }

    yield* serverLog(
      "info",
      `User authenticated for avatar upload.`,
      user.id,
      "AvatarUpload",
    );
    const bucketName = process.env.BUCKET_NAME!;
    const fileExtension = avatar.type.split("/")[1] || "jpg";
    const randomId = yield* generateId(16);
    const key = `avatars/${user.id}/${Date.now()}-${randomId}.${fileExtension}`;
    const buffer = yield* Effect.tryPromise({
      try: () => avatar.arrayBuffer(),
      catch: (cause) =>
        new FileError({
          message: `Failed to read avatar file: ${String(cause)}`,
        }),
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
      catch: (cause) => new S3UploadError({ cause }),
    }).pipe(
      Effect.tap(() =>
        serverLog(
          "info",
          `Successfully uploaded avatar to S3: ${key}`,
          user.id,
          "AvatarUpload:S3",
        ),
      ),
      Effect.tapError((e) =>
        serverLog(
          "error",
          `S3 Upload Failed: ${String(e.cause)}`,
          user.id,
          "AvatarUpload:S3",
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
      catch: (cause) => new DbUpdateError({ cause }),
    }).pipe(
      Effect.tap(() =>
        serverLog(
          "info",
          `Updated user avatar URL in DB: ${avatarUrl}`,
          user.id,
          "AvatarUpload:DB",
        ),
      ),
      Effect.tapError((e) =>
        serverLog(
          "error",
          `DB update failed: ${String(e.cause)}`,
          user.id,
          "AvatarUpload:DB",
        ),
      ),
    );
    return { avatarUrl };
  });

// --- Minimal WebSocket Sender Type to satisfy the linter ---
type WsSender = { id: string; send: (message: string) => void };

// --- Main application setup Effect ---
const setupApp = Effect.gen(function* () {
  const app = new Elysia();
  const isProduction = process.env.NODE_ENV === "production";
  const replicachePokes = yield* PubSub.unbounded<string>();
  const wsConnections = new Map<string, Fiber.RuntimeFiber<void, unknown>>();

  // --- tRPC Endpoints ---
  const handleTrpc = (context: { request: Request }) =>
    fetchRequestHandler({
      endpoint: "/trpc",
      router: appRouter,
      req: context.request,
      createContext,
    });
  app.get("/trpc/*", handleTrpc);
  app.post("/trpc/*", handleTrpc);

  // --- Replicache Endpoints ---
  app.post("/replicache/pull", async () => {
    // NOTE: Auth logic to get userId from the request would be needed here.
    // For now, it's hardcoded as in the previous example.
    const userId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    return runServerPromise(handlePull(userId as UserId));
  });

  app.post("/replicache/push", async ({ body }) => {
    // NOTE: Auth logic to get userId would also be here.
    const userId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    await runServerPromise(handlePush(body as PushRequest, userId as UserId));
    // After a successful push, "poke" all connected clients.
    await Effect.runPromise(PubSub.publish(replicachePokes, "poke"));
    return { success: true };
  });

  // --- WebSocket for Replicache Pokes ---
  app.ws("/ws", {
    // FIX: Provide an explicit, minimal type for the `ws` parameter.
    open(ws: WsSender) {
      const streamFiber = Effect.runFork(
        Effect.scoped(
          Stream.fromPubSub(replicachePokes).pipe(
            Stream.runForEach((message: string) =>
              Effect.sync(() => ws.send(message)),
            ),
          ),
        ),
      );
      wsConnections.set(ws.id, streamFiber);
      runServerUnscoped(
        serverLog(
          "info",
          `WebSocket client connected: ${ws.id}`,
          undefined, // Use undefined for non-user-specific logs
          "WS",
        ),
      );
    },
    // FIX: Provide an explicit, minimal type for the `ws` parameter.
    close(ws: WsSender) {
      const streamFiber = wsConnections.get(ws.id);
      if (streamFiber) {
        Effect.runFork(Fiber.interrupt(streamFiber));
        wsConnections.delete(ws.id);
      }
      runServerUnscoped(
        serverLog(
          "info",
          `WebSocket client disconnected: ${ws.id}`,
          undefined, // Use undefined for non-user-specific logs
          "WS",
        ),
      );
    },
  });

  // --- Other API Endpoints ---
  app.post("/api/user/avatar", (context) =>
    runServerPromise(
      avatarUploadEffect(context).pipe(
        Effect.catchTags({
          AuthError: (e) =>
            Effect.succeed(new Response(e.message, { status: 401 })),
          FileError: (e) =>
            Effect.succeed(new Response(e.message, { status: 400 })),
          S3UploadError: () =>
            Effect.succeed(new Response("S3 upload failed.", { status: 500 })),
          DbUpdateError: () =>
            Effect.succeed(
              new Response("Database update failed.", { status: 500 }),
            ),
        }),
      ),
    ),
  );
  app.post("/log/client", ({ body }) =>
    runServerPromise(
      logClientMessageEffect(body).pipe(
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
      const errorMessage = `[Production Error] Frontend build not found at: ${indexHtmlPath}.`;
      return yield* Effect.fail(new Error(errorMessage));
    }
  } else {
    yield* Effect.forkDaemon(
      serverLog("info", "Development mode. Vite will serve static files."),
    );
  }

  // --- Scheduled Jobs ---
  yield* Effect.forkDaemon(
    pipe(
      cleanupExpiredTokensEffect,
      Effect.repeat(Schedule.spaced(Duration.hours(24))),
      Effect.tapError((e) =>
        serverLog(
          "error",
          `Token cleanup job failed: ${e.message}`,
          undefined,
          "Job:TokenCleanup",
        ),
      ),
    ),
  );
  yield* Effect.forkDaemon(
    pipe(
      retryFailedEmailsEffect,
      Effect.repeat(
        Schedule.intersect(
          Schedule.exponential(Duration.minutes(1)),
          Schedule.recurs(5),
        ),
      ),
      Effect.tapError((e) =>
        serverLog(
          "error",
          `Email retry job failed: ${e.message}`,
          undefined,
          "Job:EmailRetry",
        ),
      ),
    ),
  );
  return app;
});

// --- Application Entry Point ---
const program = Effect.provide(setupApp, ServerLive);
void Effect.runPromiseExit(program).then((exit) => {
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
        serverLog("info", "Graceful shutdown complete. Exiting."),
      );
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
