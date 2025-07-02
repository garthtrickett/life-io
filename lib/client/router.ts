// lib/client/router.ts
import { TemplateResult } from "lit";
import { NotesView } from "../../components/pages/notes-list-page";
import { NoteDetailView } from "../../components/pages/note-detail-page";
import { LoginView } from "../../components/pages/login-page";
import { SignupView } from "../../components/pages/signup-page";
import { ProfileView } from "../../components/pages/profile-page";
import { NotFoundView } from "../../components/pages/not-found-page";
import { UnauthorizedView } from "../../components/pages/unauthorized-page";
import { clientLog } from "./logger.client";
import { runClientUnscoped } from "./runtime";
import { perms } from "../shared/permissions";
import { CheckEmailView } from "../../components/pages/check-email-page";
import { ForgotPasswordView } from "../../components/pages/forgot-password-page";
import { ResetPasswordView } from "../../components/pages/reset-password-page";
import { VerifyEmailView } from "../../components/pages/verify-email-page";
/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */
export interface ViewResult {
  template: TemplateResult;
  cleanup?: () => void;
}
export interface Route {
  pattern: RegExp;
  view: (...args: string[]) => ViewResult;
  meta: {
    requiresAuth?: boolean;
    requiresPerms?: string[];
    isPublicOnly?: boolean;
  };
}
type MatchedRoute = Route & { params: string[] };

/* ------------------------------------------------------------------ */
/* Route Definitions                                                  */
/* ------------------------------------------------------------------ */
const routes: Route[] = [
  {
    pattern: /^\/$/,
    view: NotesView,
    meta: { requiresAuth: true, requiresPerms: [perms.note.read] },
  },
  { pattern: /^\/login$/, view: LoginView, meta: { isPublicOnly: true } },
  { pattern: /^\/signup$/, view: SignupView, meta: { isPublicOnly: true } },
  {
    pattern: /^\/check-email$/,
    view: CheckEmailView,
    meta: { isPublicOnly: true },
  },
  {
    pattern: /^\/forgot-password$/,
    view: ForgotPasswordView,
    meta: { isPublicOnly: true },
  },
  {
    pattern: /^\/reset-password\/([^/]+)$/,
    view: ResetPasswordView,
    meta: { isPublicOnly: true },
  },
  {
    pattern: /^\/verify-email\/([^/]+)$/,
    view: VerifyEmailView,
    meta: { isPublicOnly: true },
  },
  {
    pattern: /^\/notes\/([^/]+)$/,
    view: NoteDetailView,
    meta: { requiresAuth: true, requiresPerms: [perms.note.read] },
  },
  { pattern: /^\/profile$/, view: ProfileView, meta: { requiresAuth: true } },
  { pattern: /^\/unauthorized$/, view: UnauthorizedView, meta: {} },
];
/* ------------------------------------------------------------------ */
/* Pure Functions                                                     */
/* ------------------------------------------------------------------ */

export const matchRoute = (path: string): MatchedRoute => {
  runClientUnscoped(
    clientLog("info", `Routing for path: '${path}'`, undefined, "router"),
  );
  for (const route of routes) {
    const match = path.match(route.pattern);
    if (match) {
      runClientUnscoped(
        clientLog(
          "info",
          `Route matched: ${route.pattern}`,
          undefined,
          "router",
        ),
      );
      return { ...route, params: match.slice(1) };
    }
  }
  runClientUnscoped(
    clientLog(
      "warn",
      `No match for path '${path}'. Falling back to 404.`,
      undefined,
      "router",
    ),
  );
  return { pattern: /^\/404$/, view: NotFoundView, meta: {}, params: [] };
};
export const navigate = (path: string) => {
  runClientUnscoped(
    clientLog("info", `Navigating to ${path}`, undefined, "router"),
  );
  if (window.location.pathname === path) {
    return;
  }

  const navigateTo = () => {
    window.dispatchEvent(new CustomEvent("navigate-to", { detail: { path } }));
  };
  if (document.startViewTransition) {
    document.startViewTransition(navigateTo);
  } else {
    navigateTo();
  }
};
