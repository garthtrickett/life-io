// File: lib/client/router.ts
import { signal } from "@preact/signals-core";
import { type TemplateResult } from "lit-html";
import { LoginView } from "../../components/pages/login-page";
import { SignupView } from "../../components/pages/signup-page";
import { NotesView } from "../../components/pages/notes-list-page";
import { NoteDetailView } from "../../components/pages/note-detail-page";
import { ProfileView } from "../../components/pages/profile-page";
import { NotFoundView } from "../../components/pages/not-found-page";
import { UnauthorizedView } from "../../components/pages/unauthorized-page";
import { runClientEffect } from "./runtime";
import { clientLog } from "./logger.client";
import { perms } from "../shared/permissions";

// --- Types ---
export interface ViewResult {
  template: TemplateResult;
  cleanup?: () => void;
}

export interface Route {
  pattern: RegExp; // FIX: Explicitly type the view function's arguments as strings
  view: (...args: string[]) => ViewResult;
  meta: {
    requiresAuth?: boolean;
    requiresPerms?: string[];
  };
}

/**
 * Represents the successfully matched route object that the router will always return.
 * It includes the original route definition plus the extracted URL parameters.
 */
type MatchedRoute = Route & {
  params: string[];
};

// The reactive signal that holds the current path.
export const currentPage = signal(window.location.pathname);

// A map of URL patterns to View functions.
const routes: Route[] = [
  {
    pattern: /^\/$/,
    view: NotesView,
    meta: { requiresAuth: true, requiresPerms: [perms.note.read] },
  },
  { pattern: /^\/login$/, view: LoginView, meta: { requiresAuth: false } },
  { pattern: /^\/signup$/, view: SignupView, meta: { requiresAuth: false } },
  {
    pattern: /^\/notes\/([^/]+)$/,
    view: NoteDetailView,
    meta: { requiresAuth: true, requiresPerms: [perms.note.read] },
  },
  { pattern: /^\/profile$/, view: ProfileView, meta: { requiresAuth: true } },
  { pattern: /^\/unauthorized$/, view: UnauthorizedView, meta: {} },
];

export const router = (): MatchedRoute => {
  const path = currentPage.value;
  runClientEffect(
    clientLog("info", `Routing for path: ${path}`, undefined, "router"),
  );
  for (const route of routes) {
    const match = path.match(route.pattern);
    if (match) {
      runClientEffect(
        clientLog(
          "info",
          `Route matched: ${route.pattern}.`,
          undefined,
          "router",
        ),
      );
      return { ...route, params: match.slice(1) };
    }
  }
  runClientEffect(
    clientLog(
      "warn",
      `No route matched for path: ${path}. Falling back to 404.`,
      undefined,
      "router",
    ),
  );
  return {
    pattern: /^\/404$/,
    view: NotFoundView,
    meta: {},
    params: [],
  };
};

// Public function for programmatic navigation.
export const navigate = (path: string) => {
  if (currentPage.value !== path) {
    runClientEffect(
      clientLog("info", `Navigating to ${path}`, undefined, "navigate"),
    );
    window.history.pushState({}, "", path);
    currentPage.value = path;
  }
};
