import { Config as EffectConfig, Context, Layer, Option, pipe } from "effect";

// --- Sub-configs for modularity ---

const NeonConfig = pipe(
  EffectConfig.all({
    url: EffectConfig.string("DATABASE_URL"),
    // Make localUrl optional
    localUrl: EffectConfig.option(EffectConfig.string("DATABASE_URL_LOCAL")),
    useLocalProxy: pipe(
      EffectConfig.boolean("USE_LOCAL_NEON_PROXY"),
      EffectConfig.withDefault(false),
    ),
  }),
  EffectConfig.map(({ url, localUrl, useLocalProxy }) => ({
    // Derive the final connection string based on the proxy setting and
    // whether localUrl is present.
    connectionString: pipe(
      localUrl,
      Option.filter(() => useLocalProxy), // Use localUrl only if useLocalProxy is true
      Option.getOrElse(() => url), // Fallback to the primary URL
    ),
    useLocalProxy,
  })),
);

const S3Config = EffectConfig.all({
  bucketName: EffectConfig.string("BUCKET_NAME"),
  publicAvatarUrl: EffectConfig.string("PUBLIC_AVATAR_URL"),
  endpointUrl: EffectConfig.string("AWS_ENDPOINT_URL_S3"),
  // FIX: Replace deprecated `secret` with `redacted`
  accessKeyId: EffectConfig.redacted("AWS_ACCESS_KEY_ID"),
  secretAccessKey: EffectConfig.redacted("AWS_SECRET_ACCESS_KEY"),
  region: EffectConfig.string("AWS_REGION"),
});

const LogtailConfig = EffectConfig.all({
  // FIX: Replace deprecated `secret` with `redacted`
  sourceToken: EffectConfig.redacted("LOGTAIL_SOURCE_TOKEN"),
});

const AppInfoConfig = EffectConfig.all({
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
export class Config extends Context.Tag("app/Config")<
  Config,
  EffectConfig.Config.Success<typeof AppConfigObject>
>() {}

/**
 * The live implementation of the Config service, which loads
 * configuration from the environment.
 */
export const ConfigLive = Layer.effect(Config, AppConfigObject);
