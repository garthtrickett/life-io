// FILE: ./scripts/generate-types.ts
// File: ./scripts/generate-types.ts
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { config } from "dotenv";
import { Effect, Cause, Exit, Data } from "effect";
// Import Data
import { serverLog } from "../lib/server/logger.server";

config({ path: ".env" });

const execAsync = promisify(exec);

class KanelError extends Data.TaggedError("KanelError")<{
  readonly cause: unknown;
}> {}

/**
 * An Effect-based program to run the Kanel type generation process.
 */
const generateTypes = Effect.gen(function* () {
  yield* serverLog("info", {}, "🚀 Starting Kanel type generation...");

  const command = `bunx kanel --config ./.kanelrc.cjs`;
  yield* serverLog("info", { command }, "Executing command");

  const { stdout, stderr } = yield* Effect.tryPromise({
    try: () => execAsync(command),
    // This part is already correct as it preserves the original `cause`.
    catch: (cause) => new KanelError({ cause }),
  });

  if (stderr) {
    yield* serverLog("warn", { stderr }, "Kanel process stderr");
  }
  if (stdout) {
    yield* serverLog("info", { stdout }, "Kanel process stdout");
  }

  yield* serverLog("info", {}, "✅ Type generation completed successfully!");
});

// The .catch() block was removed as runPromiseExit never rejects.
// All failures, including defects, are handled within the Exit.isFailure block.
void Effect.runPromiseExit(generateTypes).then((exit) => {
  if (Exit.isSuccess(exit)) {
    process.exit(0);
  } else {
    console.error("❌ Type generation via Kanel failed:");
    console.error(Cause.pretty(exit.cause));
    process.exit(1);
  }
});
