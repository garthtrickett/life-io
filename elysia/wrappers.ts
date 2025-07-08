// elysia/wrappers.ts
import { Effect } from "effect";
import { serverLog } from "../lib/server/logger.server";

/**
 * A reusable logging wrapper for the avatar upload feature.
 * It logs the start, success, and failure of the provided effect.
 *
 * @param userId The ID of the user performing the upload.
 * @returns An Effect that taps into the success and failure channels to log outcomes.
 */
export const withAvatarUploadLogging =
  (userId: string) =>
  <A, E>(self: Effect.Effect<A, E>): Effect.Effect<A, E> =>
    Effect.tap(
      Effect.tapBoth(self, {
        onFailure: (error) =>
          serverLog(
            "error",
            `[AvatarUpload] Failed for user ${userId}: ${
              (error as { _tag: string })._tag
            }`,
            userId,
            "AvatarUpload:Failure",
          ),
        onSuccess: () =>
          serverLog(
            "info",
            `[AvatarUpload] OK: Successfully uploaded avatar for user ${userId}`,
            userId,
            "AvatarUpload:Success",
          ),
      }),
      serverLog(
        "info",
        "Avatar upload request received.",
        userId,
        "AvatarUpload:Start",
      ),
    );
