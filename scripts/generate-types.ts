import { exec } from "node:child_process";
import { promisify } from "node:util";
import { config } from "dotenv";
import { Effect, Cause, Exit } from "effect";
import { serverLog } from "../lib/server/logger.server";

// Load environment variables from .env file
config({ path: ".env" });

const execAsync = promisify(exec);

/**
 * An Effect-based program to run the Kanel type generation process.
 */
const generateTypes = Effect.gen(function* () {
  yield* serverLog("info", "🚀 Starting Kanel type generation...");

  // Check if DATABASE_URL is set, as Kanel requires it.
  if (!process.env.DATABASE_URL) {
    return yield* Effect.fail(
      new Error("DATABASE_URL is not set in the environment variables."),
    );
  }

  // Define the Kanel command to be executed.
  const command = `bunx kanel --config ./.kanelrc.js`;

  yield* serverLog("info", `Executing command: ${command}`);

  // Execute the command as a promise-based Effect.
  const { stdout, stderr } = yield* Effect.tryPromise({
    try: () => execAsync(command),
    catch: (error) => new Error(`Kanel execution failed: ${error}`),
  });

  // Log any standard error or standard output from the Kanel process.
  if (stderr) {
    yield* serverLog("warn", `Kanel process stderr: \n${stderr}`);
  }
  if (stdout) {
    yield* serverLog("info", `Kanel process stdout: \n${stdout}`);
  }

  yield* serverLog("info", "✅ Type generation completed successfully!");
});

// --- Execution Logic ---
// Run the Effect program and handle success or failure.
Effect.runPromiseExit(generateTypes)
  .then((exit) => {
    if (Exit.isSuccess(exit)) {
      console.log("Kanel script finished successfully.");
      process.exit(0);
    } else {
      console.error(`❌ Type generation failed:`);
      // Use Cause.pretty to print a well-formatted error trace.
      console.error(Cause.pretty(exit.cause));
      process.exit(1);
    }
  })
  .catch((error) => {
    // This catches errors in the runPromiseExit itself.
    console.error("An unexpected error occurred in the script runner:", error);
    process.exit(1);
  });
