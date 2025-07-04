// File: ./scripts/generate-types.ts
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { config } from "dotenv";
import { Effect, Cause, Exit, Data } from "effect"; // Import Data
import { serverLog } from "../lib/server/logger.server";

config({ path: ".env" });

const execAsync = promisify(exec);

// --- NEW Tagged Error ---
class KanelError extends Data.TaggedError("KanelError")<{
  readonly cause: unknown;
}> {}

/**
 * An Effect-based program to run the Kanel type generation process.
 */
const generateTypes = Effect.gen(function* () {
  yield* serverLog("info", "🚀 Starting Kanel type generation...");

  const command = `bunx kanel --config ./.kanelrc.cjs`;
  yield* serverLog("info", `Executing command: ${command}`);

  const { stdout, stderr } = yield* Effect.tryPromise({
    try: () => execAsync(command),
    // Use the new tagged error
    catch: (cause) => new KanelError({ cause }),
  });

  if (stderr) {
    yield* serverLog("warn", `Kanel process stderr: \n${stderr}`);
  }
  if (stdout) {
    yield* serverLog("info", `Kanel process stdout: \n${stdout}`);
  }

  yield* serverLog("info", "✅ Type generation completed successfully!");
});

// --- Execution Logic ---
Effect.runPromiseExit(generateTypes)
  .then((exit) => {
    if (Exit.isSuccess(exit)) {
      process.exit(0);
    } else {
      console.error(Cause.pretty(exit.cause));
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error("An unexpected error occurred in the script runner:", error);
    process.exit(1);
  });
