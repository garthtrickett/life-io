// lib/server/email.ts
import { Effect } from "effect";
import { serverLog } from "./logger.server";

/**
 * A mock email sending function that logs the email details to the console.
 * In a real application, this would be replaced with a proper email service
 * like Resend, Postmark, or SendGrid.
 *
 * @param to The recipient's email address.
 * @param subject The email subject.
 * @param html The HTML content of the email.
 */
export const sendEmail = (
  to: string,
  subject: string,
  html: string,
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    yield* serverLog(
      "info",
      { to, subject, htmlBody: html }, // Structured data
      "Mock email sent", // Message
      "EmailService",
    );
  });
