// File: ./server.ts (With Scheduled Jobs)
import { staticPlugin } from "@elysiajs/static";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import {
  Cause,
  Data,
  Duration,
  Effect,
  Exit,
  Option,
  pipe,
  Schedule,
} from "effect";
import { Elysia } from "elysia";
import { existsSync, readFileSync } from "node:fs";

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { db } from "./db/kysely";
import { validateSessionEffect } from "./lib/server/auth";
import {
  cleanupExpiredTokensEffect,
  retryFailedEmailsEffect,
} from "./lib/server/jobs";
import { serverLog } from "./lib/server/logger.server";
import { runServerPromise, runServerUnscoped } from "./lib/server/runtime";
import { S3 } from "./lib/server/s3";
import { generateId } from "./lib/server/utils";
import { createContext } from "./trpc/context";
import { appRouter } from "./trpc/router";

// --- Schema imports & Error Types ---
import { Schema } from "@effect/schema";
import { formatErrorSync } from "@effect/schema/TreeFormatter";

class AuthError extends Data.TaggedError("AuthError")<{ message: string }> {}
class FileError extends Data.TaggedError("FileError")<{ message: string }> {}
class S3UploadError extends Data.TaggedError("S3UploadError")<{
  cause: unknown;
}> {}
class DbUpdateError extends Data.TaggedError("DbUpdateError")<{
  cause: unknown;
}> {}

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

// --- Route Handlers as Effects ---
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

const avatarUploadEffect = (context: { request: Request; body: unknown }) =>
  Effect.gen(function* () {
    const s3 = yield* S3;
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
    });

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
    });

    return { avatarUrl };
  });

// --- Main Application Lifecycle Effect ---
const main = Effect.gen(function* () {
  const app = new Elysia();
  const isProduction = process.env.NODE_ENV === "production";

  // --- TRPC and API Route Setup ---
  const handleTrpc = (context: { request: Request }) =>
    fetchRequestHandler({
      endpoint: "/trpc",
      router: appRouter,
      req: context.request,
      createContext,
    });

  app.get("/trpc/*", handleTrpc);
  app.post("/trpc/*", handleTrpc);

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

  // --- Static Serving ---
  if (isProduction) {
    const publicDir = "dist/public";
    const indexHtmlPath = `${publicDir}/index.html`;
    const buildExists = yield* Effect.sync(() => existsSync(indexHtmlPath));

    if (buildExists) {
      const indexHtml = yield* Effect.sync(() =>
        readFileSync(indexHtmlPath, "utf-8"),
      );
      app.use(staticPlugin({ assets: publicDir, prefix: "" }));
      app.get(
        "*",
        () =>
          new Response(indexHtml, { headers: { "Content-Type": "text/html" } }),
      );
    } else {
      const errorMessage = `[Production Mode Error] Frontend build not found! Looked for 'index.html' at: ${indexHtmlPath}.`;
      return yield* Effect.fail(new Error(errorMessage));
    }
  }

  // --- IMPLEMENTATION: Scheduled Jobs with Effect.Schedule ---
  // Run the token cleanup job in the background every 24 hours.
  yield* Effect.forkDaemon(
    pipe(
      cleanupExpiredTokensEffect,
      Effect.repeat(Schedule.spaced(Duration.hours(24))), // Define the schedule
      Effect.tapError((e) =>
        serverLog(
          "error",
          `Expired token cleanup job failed: ${e.message}`,
          undefined,
          "Job:TokenCleanup",
        ),
      ),
    ),
  );

  // Run the email retry job in the background on an exponential backoff schedule, up to 5 times.
  yield* Effect.forkDaemon(
    pipe(
      retryFailedEmailsEffect,
      Effect.repeat(
        Schedule.intersect(
          // Combine two schedules
          Schedule.exponential(Duration.minutes(1)), // Wait 1m, 2m, 4m...
          Schedule.recurs(5), // ...but only up to 5 times
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
  // --- END IMPLEMENTATION ---

  // --- Server Lifecycle Management ---
  const ServerLive = Effect.acquireRelease(
    Effect.sync(() =>
      app.listen(42069, () => {
        runServerUnscoped(
          serverLog(
            "info",
            `🦊 Elysia server listening on http://localhost:42069`,
          ),
        );
      }),
    ),
    (server, exit) =>
      Effect.gen(function* () {
        yield* serverLog("info", `Shutting down server due to ${exit._tag}...`);
        yield* Effect.promise(() => server.stop());
        yield* Effect.promise(() => db.destroy());
        yield* serverLog(
          "info",
          "Server and DB connections closed gracefully.",
        );
      }),
  );

  yield* ServerLive;
});

// --- App Execution ---
void Effect.runPromiseExit(Effect.scoped(main)).then((exit) => {
  if (Exit.isFailure(exit)) {
    console.error("\n❌ Server setup or runtime failed. Details below:\n");
    console.error(Cause.pretty(exit.cause));
    process.exit(1);
  }
});
