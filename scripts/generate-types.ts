// FILE: ./scripts/generate-types.ts
// File: ./scripts/generate-types.ts
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { config } from "dotenv";
import { Effect, Cause, Exit, Data } from "effect";
// Import Data
import { serverLog } from "../lib/server/logger.server";
// --- START OF FIX: Import the toError utility ---
// --- END OF FIX ---

config({ path: ".env" });

const execAsync = promisify(exec);

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
    // This part is already correct as it preserves the original `cause`.
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

// --- START OF FIX: Execution logic simplified to only use runPromiseExit ---
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
// --- END OF FIX ---
