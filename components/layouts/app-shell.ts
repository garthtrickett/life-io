// components/layouts/app-shell.ts
import { render, html } from "lit-html";
import { Stream, Effect, Fiber } from "effect";

import {
  appStateStream,
  ViewManager,
  ViewManagerLive,
} from "../../lib/client/lifecycle";
import { matchRoute, navigate } from "../../lib/client/router";
import { AppLayout } from "./AppLayout";
import { clientLog } from "../../lib/client/logger.client";
import { runClientPromise, runClientUnscoped } from "../../lib/client/runtime";
import { type AuthModel } from "../../lib/client/stores/authStore";

const hasAllPerms = (
  needed: string[],
  user: { permissions?: readonly string[] | null } | null,
) => needed.every((p) => user?.permissions?.includes(p));

// The core logic remains the same, but it will now render into the component instance.
const processStateChange = (
  appRoot: HTMLElement,
  {
    path,
    auth,
  }: {
    path: string;
    auth: AuthModel;
  },
) =>
  Effect.gen(function* () {
    const viewManager = yield* ViewManager;
    yield* clientLog(
      "debug",
      `Processing state: { path: "${path}", auth: "${auth.status}" }`,
      auth.user?.id,
      "AppShell:process",
    );

    if (auth.status === "initializing" || auth.status === "authenticating") {
      yield* clientLog(
        "info",
        "Auth status is initializing/authenticating. Rendering loading screen.",
        auth.user?.id,
        "AppShell:process",
      );
      const loadingTemplate = html`<div
        class="flex h-32 items-center justify-center p-8 text-center text-zinc-500"
      >
        <div
          class="h-12 w-12 animate-spin rounded-full border-4 border-zinc-300 border-t-zinc-600"
        ></div>
      </div>`;
      yield* Effect.sync(() =>
        render(AppLayout({ children: loadingTemplate }).template, appRoot),
      );
      return yield* Effect.never;
    }

    const route = matchRoute(path);
    if (route.meta.requiresAuth && auth.status === "unauthenticated") {
      yield* clientLog(
        "info",
        `Redirect: Guest on private page '${path}' -> '/login'`,
        undefined,
        "AppShell:guard",
      );
      return yield* Effect.sync(() => navigate("/login"));
    }

    if (auth.status === "authenticated" && route.meta.isPublicOnly) {
      yield* clientLog(
        "info",
        `Redirect: Authed user on public page '${path}' -> '/'`,
        auth.user?.id,
        "AppShell:guard",
      );
      return yield* Effect.sync(() => navigate("/"));
    }

    if (
      route.meta.requiresPerms &&
      !hasAllPerms(route.meta.requiresPerms, auth.user)
    ) {
      yield* clientLog(
        "warn",
        `Redirect: Insufficient perms for '${path}' -> '/unauthorized'`,
        auth.user?.id,
        "AppShell:guard",
      );
      return yield* Effect.sync(() => navigate("/unauthorized"));
    }

    yield* clientLog(
      "debug",
      `Rendering view for path '${path}'`,
      auth.user?.id,
      "AppShell:render",
    );
    yield* viewManager.cleanup();

    const viewResult = route.view(...route.params);

    const pageTemplate =
      viewResult instanceof HTMLElement
        ? html`${viewResult}`
        : viewResult.template;
    const pageCleanup =
      viewResult instanceof HTMLElement ? undefined : viewResult.cleanup;

    yield* viewManager.set(pageCleanup);

    yield* Effect.sync(() => {
      render(AppLayout({ children: pageTemplate }).template, appRoot);
    });
    yield* clientLog(
      "info",
      `Successfully rendered view for ${path}`,
      auth.user?.id,
      "AppShell:render",
    );
  });

// --- REFACTORED COMPONENT ---
export class AppShell extends HTMLElement {
  private mainFiber: Fiber.RuntimeFiber<void, unknown> | undefined;

  connectedCallback() {
    runClientUnscoped(
      clientLog(
        "info",
        "<app-shell> connected to DOM. Starting main app stream.",
        undefined,
        "AppShell",
      ),
    );
    const mainAppStream = appStateStream.pipe(
      Stream.flatMap(
        (state) => Stream.fromEffect(processStateChange(this, state)),
        { switch: true },
      ),
      Stream.provideLayer(ViewManagerLive),
    );

    this.mainFiber = Effect.runFork(Stream.runDrain(mainAppStream));
  }

  disconnectedCallback() {
    runClientUnscoped(
      clientLog(
        "warn",
        "<app-shell> disconnected from DOM. Interrupting main fiber.",
        undefined,
        "AppShell",
      ),
    );
    if (this.mainFiber) {
      void runClientPromise(Fiber.interrupt(this.mainFiber));
    }
  }
}

customElements.define("app-shell", AppShell);
