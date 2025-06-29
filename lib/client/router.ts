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
  pattern: RegExp;
  view: (...args: any[]) => ViewResult;
  meta: {
    requiresAuth?: boolean;
    requiresPerms?: string[];
  };
}

// --- FIX START: Define a consistent return type for the router ---
/**
 * Represents the successfully matched route object that the router will always return.
 * It includes the original route definition plus the extracted URL parameters.
 */
type MatchedRoute = Route & {
  params: string[];
};
// --- FIX END ---

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

// --- FIX: Add the explicit return type annotation to the function signature ---
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
      // Return the route and its matched params
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
  // --- FIX START: Ensure the fallback route matches the MatchedRoute shape ---
  return {
    pattern: /^\/404$/,
    view: NotFoundView,
    meta: {},
    params: [], // Add the missing 'params' property
  };
  // --- FIX END ---
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
