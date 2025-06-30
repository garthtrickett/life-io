// components/layouts/app-shell.ts
import { render } from "lit-html";
import { effect } from "@preact/signals-core";
import { router, currentPage, navigate } from "../../lib/client/router";
import { AppLayout } from "./AppLayout";
import { clientLog } from "../../lib/client/logger.client";
import { runClientUnscoped } from "../../lib/client/runtime";
import { authState } from "../../lib/client/stores/authStore";
import { html } from "lit-html";
import type { ViewResult } from "../../lib/client/router";

/* -------------------------------------------------------------- */
/* Local helpers                                                  */
/* -------------------------------------------------------------- */
const appRoot = document.getElementById("app")!;
let currentViewCleanup: (() => void) | undefined;
let currentView: ((...args: string[]) => ViewResult) | undefined;
const hasAllPerms = (needed: string[]) =>
  needed.every((p) => authState.value.user?.permissions?.includes(p));

/* -------------------------------------------------------------- */
/* Main reactive loop – runs on *every* path/auth change          */
/* -------------------------------------------------------------- */
effect(() => {
  runClientUnscoped(
    clientLog(
      "info",
      `-- AppShell:effect[path=${currentPage.value}] --`,
      authState.value.user?.id,
      "AppShell:effect",
    ),
  );

  const route = router();
  const auth = authState.value;
  const path = currentPage.value;

  /* 1️⃣  AUTH NOT READY ------------------------------------------------ */
  if (auth.status === "initializing" || auth.status === "authenticating") {
    runClientUnscoped(
      clientLog(
        "debug",
        "Auth not ready – showing spinner",
        undefined,
        "AppShell:guard",
      ),
    );
    render(html`<p>Loading...</p>`, appRoot);
    return;
  }

  /* 2️⃣  GUEST ON PRIVATE PAGE ---------------------------------------- */
  if (route.meta.requiresAuth && auth.status === "unauthenticated") {
    runClientUnscoped(
      clientLog(
        "info",
        `Guest blocked on '${path}'. Redirect → /login`,
        undefined,
        "AppShell:guard",
      ),
    );
    navigate("/login");
    return;
  }

  /* 3️⃣  LOGGED-IN ON PUBLIC-ONLY PAGE -------------------------------- */
  if (auth.status === "authenticated" && !route.meta.requiresAuth) {
    runClientUnscoped(
      clientLog(
        "info",
        `Authed user hit public page '${path}'. Redirect → /`,
        auth.user?.id,
        "AppShell:guard",
      ),
    );
    navigate("/");
    return;
  }

  /* 4️⃣  PERMISSION CHECK -------------------------------------------- */
  if (route.meta.requiresPerms && !hasAllPerms(route.meta.requiresPerms)) {
    runClientUnscoped(
      clientLog(
        "warn",
        `Missing perms for '${path}'. Redirect → /unauthorized`,
        auth.user?.id,
        "AppShell:guard",
      ),
    );
    navigate("/unauthorized");
    return;
  }

  /* 5️⃣  RENDER ROUTE -------------------------------------------------- */
  if (currentView && currentView !== route.view) {
    currentViewCleanup?.();
  }
  currentView = route.view;

  const { template: pageTemplate, cleanup: pageCleanup } = route.view(
    ...route.params,
  );
  render(AppLayout({ children: pageTemplate }).template, appRoot);
  currentViewCleanup = pageCleanup;

  runClientUnscoped(
    clientLog("debug", `Rendered '${path}'`, auth.user?.id, "AppShell:render"),
  );
});
