// lib/client/loggingLink.ts
import { TRPCLink } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { runClientUnscoped } from "./runtime";
import { clientLog } from "./logger.client";

/**
 * A tRPC link that streams every operation (request & response)
 * to BetterStack through `clientLog`.
 *
 * →   tRPC call sent
 * ←   tRPC response received
 */
export const loggingLink =
  <TRouter extends AnyRouter>(): TRPCLink<TRouter> =>
  () => {
    return ({ op, next }) =>
      observable((observer) => {
        // ---- outgoing -----------------------------------------------------
        runClientUnscoped(
          clientLog(
            "debug",
            `tRPC → [${op.type}] ${op.path}`,
            undefined,
            "tRPC",
          ),
        );

        const subscription = next(op).subscribe({
          next(data) {
            // ---- incoming --------------------------------------------------
            runClientUnscoped(
              clientLog(
                "debug",
                `tRPC ← [${op.type}] ${op.path}`,
                undefined,
                "tRPC",
              ),
            );
            observer.next(data);
          },
          error(err) {
            const errorMessage =
              err instanceof Error ? err.message : String(err);
            runClientUnscoped(
              clientLog(
                "error",
                `tRPC ✖  [${op.type}] ${op.path}: ${errorMessage}`,
                undefined,
                "tRPC",
              ),
            );
            observer.error(err);
          },
          complete() {
            observer.complete();
          },
        });

        return () => subscription.unsubscribe();
      });
  };
