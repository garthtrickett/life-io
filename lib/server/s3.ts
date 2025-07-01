// FILE: lib/server/s3.ts
import { S3Client } from "@aws-sdk/client-s3";
import { Context, Effect, Layer } from "effect";

/**
 * Defines a Tag for the S3Client service, allowing it to be used
 * with Effect's dependency injection system.
 */
export class S3 extends Context.Tag("S3")<S3, S3Client>() {}

/**
 * Provides a live implementation of the S3Client service.
 * This Layer creates the S3 client from environment variables.
 * Using a Layer makes the S3 dependency test-friendly, as it can be
 * easily swapped with a mock implementation in tests.
 */
export const S3Live = Layer.effect(
  S3,
  Effect.sync(() => {
    const region = process.env.AWS_REGION!;
    const endpoint = process.env.AWS_ENDPOINT_URL_S3!;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID!;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY!;

    if (!region || !endpoint || !accessKeyId || !secretAccessKey) {
      console.warn(
        "S3 client not configured. Missing required environment variables (AWS_REGION, AWS_ENDPOINT_URL_S3, etc.).",
      );
    }

    return new S3Client({
      region,
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }),
);
