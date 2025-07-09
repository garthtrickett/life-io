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
            "error", // level
            { userId, error }, // data
            `[AvatarUpload] Failure: ${(error as { _tag: string })._tag}`, // message
            "AvatarUpload:Failure",
          ),
        onSuccess: () =>
          serverLog(
            "info", // level
            { userId }, // data
            "[AvatarUpload] OK: Successfully uploaded avatar", // message
            "AvatarUpload:Success",
          ),
      }),
      serverLog(
        "info", // level
        { userId }, // data
        "Avatar upload request received.",
        "AvatarUpload:Start",
      ),
    );
