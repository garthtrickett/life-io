// File: lib/client/router.ts
import { signal } from "@preact/signals-core";
import { LoginView } from "../../components/pages/login-page";
import { SignupView } from "../../components/pages/signup-page";
import { NotesView } from "../../components/pages/notes-list-page";
import { NoteDetailView } from "../../components/pages/note-detail-page";
import { ProfileView } from "../../components/pages/profile-page";
import { NotFoundView } from "../../components/pages/not-found-page";
import { runClientEffect } from "./runtime";
import { clientLog } from "./logger.client";

// The reactive signal that holds the current path.
export const currentPage = signal(window.location.pathname);

// A map of URL patterns to View functions.
const routes: Record<string, (...args: any[]) => any> = {
  "/": NotesView, // Home page is the notes list
  "/login": LoginView,
  "/signup": SignupView,
  "/notes/:id": NoteDetailView,
  "/profile": ProfileView,
};

// This function is called by the main render loop. It finds the matching
// route and executes its view function to get the template and cleanup logic.
export const router = () => {
  const path = currentPage.value;
  runClientEffect(
    clientLog(
      "info",
      `router() is running for path: ${path}`,
      undefined,
      "router",
    ),
  );
  for (const route in routes) {
    const pattern = new RegExp(`^${route.replace(/:\w+/g, "([^/]+)")}$`);
    const match = path.match(pattern);
    if (match) {
      const params = match.slice(1);
      runClientEffect(
        clientLog(
          "info",
          `Route matched: ${route}. Calling view function.`,
          undefined,
          "router",
        ),
      );
      return routes[route](...params); // e.g., NoteDetailView(id)
    }
  }
  runClientEffect(
    clientLog(
      "info",
      `No route matched for ${path}. Rendering NotFoundView.`,
      undefined,
      "router",
    ),
  );
  return NotFoundView(); // Fallback
};

// Public function for programmatic navigation.
export const navigate = (path: string) => {
  if (window.location.pathname === path) return;
  runClientEffect(
    clientLog(
      "info",
      `navigate() called with path: ${path}`,
      undefined,
      "router",
    ),
  );
  window.history.pushState({}, "", path);
  currentPage.value = path;
};

// Listen to browser navigation events to keep the signal in sync.
window.addEventListener("popstate", () => {
  currentPage.value = window.location.pathname;
});

// Intercept all link clicks to use our SPA router.
document.body.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const anchor = (e.target as HTMLElement).closest("a");
  if (
    anchor &&
    anchor.target !== "_blank" &&
    anchor.origin === window.location.origin
  ) {
    e.preventDefault();
    navigate(anchor.pathname);
  }
});
