// lib/client/replicache/websocket.ts
import type { Replicache } from "replicache";
import { clientLog } from "../logger.client";
import { runClientUnscoped } from "../runtime";
import { toError } from "../../shared/toError";
import type { Mutators } from "./types";

export function setupWebSocket(rep: Replicache<Mutators> | null) {
  const ws = new WebSocket(
    `${window.location.protocol === "https:" ? "wss" : "ws"}://${
      window.location.host
    }/ws`,
  );
  ws.onopen = () => {
    runClientUnscoped(
      clientLog(
        "info",
        "[POKE DEBUG] WebSocket connection opened.",
        undefined,
        "Replicache:WS",
      ),
    );
  };

  ws.onerror = (event) => {
    runClientUnscoped(
      clientLog(
        "error",
        `[POKE DEBUG] WebSocket error. Event: ${JSON.stringify(event)}`,
        undefined,
        "Replicache:WS",
      ),
    );
  };

  ws.onmessage = (event) => {
    if (event.data === "poke" && rep) {
      void (async () => {
        try {
          runClientUnscoped(
            clientLog(
              "info",
              "[POKE DEBUG] Poke received, awaiting rep.pull()...",
              undefined,
              "Replicache:WS",
            ),
          );
          await rep.pull();
          runClientUnscoped(
            clientLog(
              "info",
              "[POKE DEBUG] rep.pull() completed successfully after poke.",
              undefined,
              "Replicache:WS",
            ),
          );
        } catch (e) {
          runClientUnscoped(
            clientLog(
              "error",
              `[POKE DEBUG] Error executing pull after poke: ${
                toError(e).message
              }`,
            ),
          );
        }
      })();
    }
  };
}
