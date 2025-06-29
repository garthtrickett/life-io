// File: components/layouts/app-shell.ts
import { render } from "lit-html";
import { effect } from "@preact/signals-core";
import { router, currentPage, navigate } from "../../lib/client/router";
import { AppLayout } from "./AppLayout";
import { clientLog } from "../../lib/client/logger.client";
import { runClientEffect } from "../../lib/client/runtime";
import { authState } from "../../lib/client/stores/authStore";
import { html } from "lit-html";

const appRoot = document.getElementById("app")!;
let currentViewCleanup: (() => void) | undefined;

const hasAllPerms = (needed: string[]) => {
  const userPerms = authState.value.user?.permissions ?? [];
  return needed.every((p) => userPerms.includes(p));
};

// The main render loop.
effect(() => {
  runClientEffect(
    clientLog(
      "info",
      `-- AppShell:effect[path=${currentPage.value}] --`,
      undefined,
      "AppShell:effect",
    ),
  );

  const route = router();
  const auth = authState.value;
  const currentPath = currentPage.value;

  // --- 1. GUARD LOGIC ---
  // If auth is still initializing, show a loading screen and stop.
  if (auth.status === "initializing" || auth.status === "authenticating") {
    render(
      html`
        <p>Loading...</p>
      `,
      appRoot,
    ); // Simple loading indicator
    return;
  }

  const isPublicPath = !route.meta.requiresAuth;

  // --- Rule: Unauthenticated user on a private page ---
  if (route.meta.requiresAuth && auth.status === "unauthenticated") {
    runClientEffect(
      clientLog(
        "info",
        `Route Guard: Not authenticated for private path '${currentPath}'. Redirecting to /login.`,
        undefined,
        "AppShell",
      ),
    );
    navigate("/login");
    return;
  }

  // --- Rule: Authenticated user on a public-only page (login/signup) ---
  if (auth.status === "authenticated" && isPublicPath) {
    runClientEffect(
      clientLog(
        "info",
        `Route Guard: Authenticated on public path '${currentPath}'. Redirecting to /.`,
        auth.user?.id,
        "AppShell",
      ),
    );
    navigate("/");
    return;
  }

  // --- Rule: Check for granular permissions ---
  if (route.meta.requiresPerms && !hasAllPerms(route.meta.requiresPerms)) {
    runClientEffect(
      clientLog(
        "warn",
        `Route Guard: Insufficient permissions for '${currentPath}'. Redirecting to /unauthorized.`,
        auth.user?.id,
        "AppShell",
      ),
    );
    navigate("/unauthorized");
    return;
  }

  // --- 2. RENDER LOGIC ---
  // If all guards pass, proceed to render the page.

  // 1. Run the cleanup function for the view we are navigating away from.
  if (currentViewCleanup) {
    currentViewCleanup();
  }

  // 2. Get the new view object from the router.
  // We already have the `route` object from the top of the effect.
  const currentView = route.view(...(route.params ?? []));

  // 3. Render the new view's template inside the main layout.
  const layoutResult = AppLayout({ children: currentView.template });
  render(layoutResult.template, appRoot);

  // 4. Store the new view's cleanup function for the next route change.
  currentViewCleanup = currentView.cleanup;
});
