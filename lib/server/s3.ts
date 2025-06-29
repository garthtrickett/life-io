// FILE: lib/server/s3.ts
import { S3Client } from "@aws-sdk/client-s3";

// --- FIX: Use environment variables from .env file ---
const region = process.env.AWS_REGION!;
const endpoint = process.env.AWS_ENDPOINT_URL_S3!;
const accessKeyId = process.env.AWS_ACCESS_KEY_ID!;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY!;

if (!region || !endpoint || !accessKeyId || !secretAccessKey) {
  // In local dev, these won't be set, which is fine if we don't test uploads.
  // In production, this would indicate a configuration error.
  console.warn(
    "S3 client not configured. Missing required environment variables (AWS_REGION, AWS_ENDPOINT_URL_S3, etc.).",
  );
}

// Export a pre-configured S3 client
export const s3 = new S3Client({
  region,
  endpoint,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});
