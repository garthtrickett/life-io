// File: ./elysia/handlers.ts
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

// --- Schemas ---

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

// --- Handlers ---

export const handleAvatarUpload = (context: {
  request: Request;
  body: unknown;
}) =>
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

    const user = yield* authenticateRequestEffect(context.request);

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
    );
    return { avatarUrl };
  });

export const handleClientLog = (body: unknown) =>
  Effect.gen(function* () {
    const { level: levelFromClient, args } = yield* Schema.decodeUnknown(
      ClientLogBody,
    )(body).pipe(
      Effect.mapError((e) => new FileError({ message: formatErrorSync(e) })),
    );

    if (isLoggableLevel(levelFromClient)) {
      const message = Array.isArray(args)
        ? args.map(String).join(" ")
        : String(args);

      yield* Effect.forkDaemon(
        serverLog(levelFromClient, `[CLIENT] ${message}`, undefined, "Client"),
      );
    }
    return new Response(null, { status: 204 });
  });
