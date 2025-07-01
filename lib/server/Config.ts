// lib/server/Config.ts
import { Config as EffectConfig, Context, Layer, pipe } from "effect";

// --- Sub-configs for modularity ---

const NeonConfig = EffectConfig.all({
  url: EffectConfig.string("DATABASE_URL"),
  localUrl: EffectConfig.string("DATABASE_URL_LOCAL"),
  // FIX: Use the pipeable `withDefault` operator
  useLocalProxy: pipe(
    EffectConfig.boolean("USE_LOCAL_NEON_PROXY"),
    EffectConfig.withDefault(false),
  ),
}).pipe(
  EffectConfig.map(({ url, localUrl, useLocalProxy }) => ({
    // Derive the final connection string based on the proxy setting
    connectionString: useLocalProxy ? localUrl : url,
    useLocalProxy,
  })),
);

const S3Config = EffectConfig.all({
  bucketName: EffectConfig.string("BUCKET_NAME"),
  publicAvatarUrl: EffectConfig.string("PUBLIC_AVATAR_URL"),
  endpointUrl: EffectConfig.string("AWS_ENDPOINT_URL_S3"),
  accessKeyId: EffectConfig.secret("AWS_ACCESS_KEY_ID"),
  secretAccessKey: EffectConfig.secret("AWS_SECRET_ACCESS_KEY"),
  region: EffectConfig.string("AWS_REGION"),
});

const LogtailConfig = EffectConfig.all({
  sourceToken: EffectConfig.secret("LOGTAIL_SOURCE_TOKEN"),
});

const AppInfoConfig = EffectConfig.all({
  // FIX: Use the pipeable `withDefault` operator
  nodeEnv: pipe(
    EffectConfig.string("NODE_ENV"),
    EffectConfig.withDefault("development"),
  ),
  isProduction: EffectConfig.map(
    EffectConfig.string("NODE_ENV"),
    (env) => env === "production",
  ),
});

// --- Unified Config Service ---

const AppConfigObject = EffectConfig.all({
  neon: NeonConfig,
  s3: S3Config,
  logtail: LogtailConfig,
  app: AppInfoConfig,
});

/**
 * The main Config service for the application.
 * Other services will depend on this to get their configuration.
 */
// FIX: Use EffectConfig.Success to correctly extract the type from the Config object.
export class Config extends Context.Tag("app/Config")<
  Config,
  EffectConfig.Config.Success<typeof AppConfigObject>
>() {}

/**
 * The live implementation of the Config service, which loads
 * configuration from the environment.
 */
export const ConfigLive = Layer.effect(Config, AppConfigObject);
