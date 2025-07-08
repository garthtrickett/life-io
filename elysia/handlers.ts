/* -------------------------------------------------------------------------- */
/* elysia/handlers.ts                                                        */
/* -------------------------------------------------------------------------- */

import { Effect } from "effect";
import { Schema } from "@effect/schema";
import { formatErrorSync } from "@effect/schema/TreeFormatter";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { generateId } from "../lib/server/utils";
import { S3 } from "../lib/server/s3";
import { Db } from "../db/DbTag";
import { authenticateRequestEffect } from "./auth";
import { DbUpdateError, FileError, S3UploadError } from "./errors";
import { withAvatarUploadLogging } from "./wrappers"; // ⬅️ **Import the new wrapper**

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

/* ───────────────────────────── Core Logic Effect ────────────────────────── */

/**
 * The core business logic for handling an avatar upload, free of any
 * cross-cutting concerns like logging.
 */
const handleAvatarUploadEffect = (ctx: { request: Request; body: unknown }) =>
  Effect.gen(function* () {
    const s3 = yield* S3;
    const db = yield* Db;

    // 1. Decode and validate the uploaded file
    const { avatar } = yield* Schema.decodeUnknown(AvatarUploadBody)(
      ctx.body,
    ).pipe(
      Effect.mapError((e) => new FileError({ message: formatErrorSync(e) })),
    );

    // 2. Authenticate the user
    const user = yield* authenticateRequestEffect(ctx.request);

    // 3. Prepare file for S3
    const bucketName = process.env.BUCKET_NAME!;
    const fileExt = avatar.type.split("/")[1] ?? "jpg";
    const key = `avatars/${
      user.id
    }/${Date.now()}-${yield* generateId(16)}.${fileExt}`;

    const buf = yield* Effect.tryPromise({
      try: () => avatar.arrayBuffer(),
      catch: (cause) =>
        new FileError({
          message: `Failed to read avatar file: ${String(cause)}`,
        }),
    });

    // 4. Upload to S3
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
    });

    // 5. Update the user's record in the database
    const avatarUrl = `${process.env.PUBLIC_AVATAR_URL!}/${key}`;
    yield* Effect.tryPromise({
      try: () =>
        db
          .updateTable("user")
          .set({ avatar_url: avatarUrl })
          .where("id", "=", user.id)
          .execute(),
      catch: (cause) => new DbUpdateError({ cause }),
    });

    // 6. Return the new URL
    return { avatarUrl, user };
  });

/* ───────────────── Public Handler with Logging Wrapper ────────────────── */

/**
 * The public-facing handler that composes the core logic with the logging
 * wrapper. This keeps the main "story" clean and readable.
 */
export const handleAvatarUpload = (ctx: { request: Request; body: unknown }) =>
  handleAvatarUploadEffect(ctx).pipe(
    // We get the user from the result of the core effect and use it
    // to apply the logging wrapper.
    Effect.flatMap(({ avatarUrl, user }) =>
      Effect.succeed({ avatarUrl }).pipe(withAvatarUploadLogging(user.id)),
    ),
  );
