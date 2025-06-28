// FILE: lib/client/router.ts

/**
 * A helper function for requesting programmatic navigation.
 * This dispatches a custom event that the app-shell listens for,
 * allowing navigation to be centralized and wrapped in view transitions.
 * @param path The path to navigate to.
 */
export const navigate = (path: string) => {
  // Dispatch the event on the window, so any component can listen.
  // The app-shell will be the one to catch it.
  window.dispatchEvent(
    new CustomEvent("navigate-to", {
      detail: { path },
      bubbles: true,
      composed: true,
    }),
  );
};
