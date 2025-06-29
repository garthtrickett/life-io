// File: index.ts
import { render } from "lit-html";
import { effect } from "@preact/signals-core";
import { router, currentPage } from "../../lib/client/router";
import { AppLayout } from "./AppLayout.ts";
import { clientLog } from "../../lib/client/logger.client";
import { runClientEffect } from "../../lib/client/runtime";

const appRoot = document.getElementById("app")!;
let currentViewCleanup: (() => void) | undefined;

// The main render loop.
effect(() => {
  runClientEffect(
    clientLog(
      "info",
      `AppShell main render effect triggered. Path: ${currentPage.value}`,
      undefined,
      "AppShell:effect",
    ),
  );
  // 1. Run the cleanup function for the view we are navigating away from.
  if (currentViewCleanup) {
    currentViewCleanup();
  }

  // 2. Get the new view object from the router.
  const currentView = router();

  // 3. Render the new view's template inside the main layout.
  // --- FIX: Extract the .template property from the AppLayout's result ---
  const layoutResult = AppLayout({ children: currentView.template });
  render(layoutResult.template, appRoot);

  // 4. Store the new view's cleanup function for the next route change.
  currentViewCleanup = currentView.cleanup;
});
