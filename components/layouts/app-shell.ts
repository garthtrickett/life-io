// =================================================================
// FILE: components/layouts/app-shell.ts
// =================================================================
import { render, html } from "lit-html";
import { Stream, Effect, Fiber, Layer } from "effect";
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
import { LocationLive } from "../../lib/client/LocationService";

const hasAllPerms = (
  needed: string[],
  user: { permissions?: readonly string[] | null } | null,
) => needed.every((p) => user?.permissions?.includes(p));

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
        "debug",
        "Auth status is initializing/authenticating. Rendering full-page loader.",
        auth.user?.id,
        "AppShell:process",
      );
      // This is a full-page loader, not content within the AppLayout
      const fullPageLoader = html`<div
        class="flex min-h-screen items-center justify-center bg-gray-50"
      >
        <div
          class="h-12 w-12 animate-spin rounded-full border-4 border-zinc-300 border-t-zinc-600"
        ></div>
      </div>`;
      // Render the loader directly into the app shell, bypassing the main layout
      yield* Effect.sync(() => render(fullPageLoader, appRoot));
      return yield* Effect.never;
    }

    const route = yield* matchRoute(path);

    if (route.meta.requiresAuth && auth.status === "unauthenticated") {
      yield* clientLog(
        "info",
        `Redirect: Guest on private page '${path}' -> '/login'`,
        undefined,
        "AppShell:guard",
      );
      return yield* navigate("/login");
    }

    if (auth.status === "authenticated" && route.meta.isPublicOnly) {
      yield* clientLog(
        "info",
        `Redirect: Authed user on public page '${path}' -> '/'`,
        auth.user?.id,
        "AppShell:guard",
      );
      return yield* navigate("/");
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
      return yield* navigate("/unauthorized");
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

    const AppShellLive = Layer.merge(ViewManagerLive, LocationLive);

    const mainAppStream = appStateStream.pipe(
      Stream.flatMap(
        (state) => Stream.fromEffect(processStateChange(this, state)),
        { switch: true },
      ),
      Stream.provideLayer(AppShellLive),
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
