// File: lib/client/router.ts
import { signal } from "@preact/signals-core";
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
  meta: { requiresAuth?: boolean; requiresPerms?: string[] };
}
type MatchedRoute = Route & { params: string[] };

/* ------------------------------------------------------------------ */
/* Internal state                                                     */
/* ------------------------------------------------------------------ */
export const currentPage = signal(window.location.pathname);

const routes: Route[] = [
  {
    pattern: /^\/$/,
    view: NotesView,
    meta: { requiresAuth: true, requiresPerms: [perms.note.read] },
  },
  { pattern: /^\/login$/, view: LoginView, meta: {} },
  { pattern: /^\/signup$/, view: SignupView, meta: {} },
  {
    pattern: /^\/check-email$/,
    view: CheckEmailView,
    meta: {},
  },
  {
    pattern: /^\/forgot-password$/,
    view: ForgotPasswordView,
    meta: {},
  },
  {
    pattern: /^\/reset-password\/([^/]+)$/,
    view: ResetPasswordView,
    meta: {},
  },
  {
    pattern: /^\/verify-email\/([^/]+)$/,
    view: VerifyEmailView,
    meta: {},
  },
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

/* Public helper ----------------------------------------------------- */
export const navigate = (path: string) => {
  if (currentPage.value === path) {
    return;
  }

  const navigateTo = () => {
    window.history.pushState({}, "", path);
    currentPage.value = path;
  };

  if (document.startViewTransition) {
    document.startViewTransition(navigateTo);
  } else {
    navigateTo();
  }
};
