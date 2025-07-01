// FILE: lib/server/s3.ts
import { S3Client } from "@aws-sdk/client-s3";
import { Context, Effect, Layer, Redacted } from "effect"; // Import Redacted instead of Secret
import { Config } from "./Config";

/**
 * Defines a Tag for the S3Client service, allowing it to be used
 * with Effect's dependency injection system.
 */
export class S3 extends Context.Tag("S3")<S3, S3Client>() {}

/**
 * Provides a live implementation of the S3Client service.
 * This Layer creates the S3 client from the injected Config service.
 * Using a Layer makes the S3 dependency test-friendly, as it can be
 * easily swapped with a mock implementation in tests.
 */
export const S3Live = Layer.effect(
  S3,
  Effect.gen(function* () {
    const config = yield* Config;
    const { region, endpointUrl, accessKeyId, secretAccessKey } = config.s3;

    return new S3Client({
      region,
      endpoint: endpointUrl,
      credentials: {
        // FIX: Use Redacted.value to get the string from the Redacted config
        accessKeyId: Redacted.value(accessKeyId),
        secretAccessKey: Redacted.value(secretAccessKey),
      },
    });
  }),
);
