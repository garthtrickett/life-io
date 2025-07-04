// FILE: elysia/handlers.ts
/* -------------------------------------------------------------------------- */
/*  elysia/handlers.ts                                                        */
/* -------------------------------------------------------------------------- */

import { Effect } from "effect";
import { Schema } from "@effect/schema";
import { formatErrorSync } from "@effect/schema/TreeFormatter";
import { PutObjectCommand } from "@aws-sdk/client-s3";

import { serverLog } from "../lib/server/logger.server";
import { generateId } from "../lib/server/utils";
import { S3 } from "../lib/server/s3";
import { Db } from "../db/DbTag";
import { authenticateRequestEffect } from "./auth";
import { DbUpdateError, FileError, S3UploadError } from "./errors";

/* ───────────────────────────── Schemas ──────────────────────────────────── */

const AvatarUploadBody = Schema.Struct({
  avatar: Schema.instanceOf(File).pipe(
    Schema.filter((file) => file.size <= 5 * 1024 * 1024, {
      message: () => "File size must not exceed 5 MB.",
    }),
    Schema.filter(
      (file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type),
      {
        message: () =>
          "File type must be one of image/jpeg, image/png, image/webp.",
      },
    ),
  ),
});

const ClientLogBody = Schema.Struct({
  level: Schema.String,
  args: Schema.Array(Schema.Any),
});
type ServerLoggableLevel = "info" | "error" | "warn" | "debug";
const isLoggableLevel = (l: string): l is ServerLoggableLevel =>
  ["info", "error", "warn", "debug"].includes(l);

/* ───────────────────────────── Handlers ─────────────────────────────────── */

export const handleAvatarUpload = (ctx: { request: Request; body: unknown }) =>
  Effect.gen(function* () {
    yield* serverLog(
      "info",
      "Avatar upload request received.",
      undefined,
      "AvatarUpload",
    );

    const s3 = yield* S3;
    const db = yield* Db;

    const { avatar } = yield* Schema.decodeUnknown(AvatarUploadBody)(
      ctx.body,
    ).pipe(
      Effect.mapError((e) => new FileError({ message: formatErrorSync(e) })),
    );

    const user = yield* authenticateRequestEffect(ctx.request);

    yield* serverLog(
      "info",
      "User authenticated for avatar upload.",
      user.id,
      "AvatarUpload",
    );

    const bucketName = process.env.BUCKET_NAME!;
    const fileExt = avatar.type.split("/")[1] ?? "jpg";
    const key = `avatars/${user.id}/${Date.now()}-${yield* generateId(16)}.${fileExt}`;

    const buf = yield* Effect.tryPromise({
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
            Body: Buffer.from(buf),
            ContentType: avatar.type,
          }),
        ),
      catch: (cause) => new S3UploadError({ cause }),
    }).pipe(
      Effect.tap(() =>
        serverLog(
          "info",
          `Uploaded avatar to S3: ${key}`,
          user.id,
          "AvatarUpload:S3",
        ),
      ),
    );

    const avatarUrl = `${process.env.PUBLIC_AVATAR_URL!}/${key}`;

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
          `Updated DB avatar URL: ${avatarUrl}`,
          user.id,
          "AvatarUpload:DB",
        ),
      ),
    );

    return { avatarUrl };
  });

export const handleClientLog = (rawBody: unknown) =>
  Effect.gen(function* () {
    /* ── Need-more-visibility: dump whatever arrived ─────────────────────── */
    yield* serverLog(
      "debug",
      `Raw client log body: ${
        typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody)
      }`,
      undefined,
      "Client:RAW",
    );

    /* Accept either real JSON or the text/plain payload produced by          *
     * navigator.sendBeacon.                                                  */
    // --- START OF FIX ---
    const body: unknown =
      typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
    // --- END OF FIX ---

    const { level, args } = yield* Schema.decodeUnknown(ClientLogBody)(
      body,
    ).pipe(
      Effect.mapError((e) => new FileError({ message: formatErrorSync(e) })),
    );

    if (isLoggableLevel(level)) {
      const msg = Array.isArray(args)
        ? args.map(String).join(" ")
        : String(args);
      yield* serverLog(level, `[CLIENT] ${msg}`, undefined, "Client");
    }

    return new Response(null, { status: 204 });
  });
