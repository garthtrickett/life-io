// FILE: lib/client/replicache/websocket.ts

import type { Replicache } from "replicache";
import { clientLog } from "../logger.client";
import { runClientUnscoped } from "../runtime";
import { toError } from "../../shared/toError";
import type { Mutators } from "./types";

// Helper to get a cookie value
const getCookie = (name: string): string | undefined => {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(";").shift();
};

export function setupWebSocket(rep: Replicache<Mutators> | null) {
  const sessionId = getCookie("session_id");
  if (!sessionId) {
    runClientUnscoped(
      clientLog(
        "error",
        "No session_id cookie found for WebSocket connection.",
      ),
    );
    return;
  }

  const wsUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://${
    window.location.host
  }/ws?sessionId=${sessionId}`;

  const ws = new WebSocket(wsUrl);

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
    } else if (event.data === '{"error":"authentication_failed"}') {
      ws.close(1008, "Authentication failed");
      runClientUnscoped(
        clientLog("error", "WebSocket closed due to authentication failure."),
      );
    }
  };
}
