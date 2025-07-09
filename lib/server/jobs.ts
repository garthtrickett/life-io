// FILE: lib/server/jobs.ts
import { Effect } from "effect";
import { Db } from "../../db/DbTag";
import { serverLog } from "./logger.server";
import { EmailSendError } from "../../features/auth/Errors";
import { sendEmail } from "./email";

/**
 * Effect to clean up expired email verification and password reset tokens.
 * --- MODIFIED: This effect now depends on the `Db` service ---
 */
export const cleanupExpiredTokensEffect: Effect.Effect<void, Error, Db> =
  Effect.gen(function* () {
    const db = yield* Db; // Get the DB instance from the context

    yield* serverLog(
      "info",
      {},
      "Starting cleanup of expired tokens...",
      "Job:TokenCleanup",
    );

    const now = new Date();

    // Clean up expired email verification tokens
    const deletedEmailTokens = yield* Effect.tryPromise({
      try: () =>
        db
          .deleteFrom("email_verification_token")
          .where("expires_at", "<", now)
          .execute(),
      catch: (cause) =>
        new Error(
          `Failed to delete expired email verification tokens: ${String(
            cause,
          )}`,
          { cause },
        ),
    });

    // FIX: Access the first element for numDeletedRows
    const numDeletedEmail = deletedEmailTokens[0]?.numDeletedRows ?? 0;
    yield* serverLog(
      "info",
      { count: numDeletedEmail },
      "Cleaned up expired email verification tokens.",
      "Job:TokenCleanup",
    );

    // Clean up expired password reset tokens
    const deletedPasswordTokens = yield* Effect.tryPromise({
      try: () =>
        db
          .deleteFrom("password_reset_token")
          .where("expires_at", "<", now)
          .execute(),
      catch: (cause) =>
        new Error(
          `Failed to delete expired password reset tokens: ${String(cause)}`,
          { cause },
        ),
    });

    // FIX: Access the first element for numDeletedRows
    const numDeletedPassword = deletedPasswordTokens[0]?.numDeletedRows ?? 0;
    yield* serverLog(
      "info",
      { count: numDeletedPassword },
      "Cleaned up expired password reset tokens.",
      "Job:TokenCleanup",
    );

    yield* serverLog(
      "info",
      {},
      "Finished cleanup of expired tokens.",
      "Job:TokenCleanup",
    );
  });

/**
 * Effect to retry sending failed emails.
 * This is a simplified example. In a real application, you would
 * have a more robust "durable queue" mechanism, likely involving
 * a database table for failed email attempts with a retry count and last attempt timestamp.
 * For this implementation, we'll simulate retrying a fixed "failed" email.
 */
export const retryFailedEmailsEffect = Effect.gen(function* () {
  // In a real scenario, fetch emails from a 'failed_emails' table
  // For this example, we'll hardcode a dummy failed email that needs retrying.
  const dummyFailedEmail = {
    to: "failed@example.com",
    subject: "Test Retry Email",
    html: "This is a test of the email retry mechanism.",
    retries: 0, // Simulate a retry counter
  };

  if (dummyFailedEmail.retries < 5) {
    // Max 5 retries
    yield* serverLog(
      "info",
      { to: dummyFailedEmail.to },
      "Attempting to retry sending email...",
      "Job:EmailRetry",
    );

    // FIX: Removed the unnecessary check for `sendAttempt._tag === "Success"`
    // sendEmail returns Effect<void, Error>, so `sendAttempt` would be `void` on success.
    // The `Effect.tapError` handles the logging for failures.
    yield* sendEmail(
      dummyFailedEmail.to,
      dummyFailedEmail.subject,
      dummyFailedEmail.html,
    ).pipe(
      Effect.tapError((e) =>
        serverLog(
          "warn",
          {
            to: dummyFailedEmail.to,
            attempt: dummyFailedEmail.retries + 1,
            error: e,
          },
          "Failed to send email",
          "Job:EmailRetry",
        ),
      ),
      // Here, instead of succeeding with `void`, we could return the error to be handled externally
      // but for demonstration, we'll let Effect.retry handle the re-scheduling.
      Effect.catchAll(() =>
        Effect.fail(new EmailSendError({ cause: "Simulated send failure" })),
      ),
    );

    // If we reach here, it means sendEmail either succeeded (with void) or was caught by retry/catchAll.
    // For this simulation, we can log success or increment retries directly after the pipe.
    // In a real durable queue, this would involve database updates.
    yield* serverLog(
      "info",
      { to: dummyFailedEmail.to },
      "Email retry attempt completed.",
      "Job:EmailRetry",
    );
    dummyFailedEmail.retries++;
  } else {
    yield* serverLog(
      "warn",
      { to: dummyFailedEmail.to },
      "Max retries reached for email. Giving up.",
      "Job:EmailRetry",
    );
    // In a real system, move the email to a 'dead_letter' queue or alert.
  }
});
