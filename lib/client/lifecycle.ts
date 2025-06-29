// File: lib/client/lifecycle.ts
import { effect } from "@preact/signals-core";

type CleanupFn = () => void;
// Use a WeakMap to avoid memory leaks by not holding strong references to the scope.
const cleanupMap = new WeakMap<object, CleanupFn>();

/**
 * A hook for managing side-effects with cleanup, inspired by React's useEffect.
 * @param effectFn The function to run, which can optionally return a cleanup function.
 * @param scope A unique object for this effect instance (e.g., the component's state object).
 */
export function useEffect(effectFn: () => void | CleanupFn, scope: object) {
  // Use `effect` from signals to automatically re-run when signals used inside change.
  effect(() => {
    // Run the previous cleanup function for this scope, if it exists.
    cleanupMap.get(scope)?.();

    // Run the new effect function.
    const newCleanup = effectFn();

    // If the effect function returned a new cleanup function, store it.
    if (newCleanup) {
      cleanupMap.set(scope, newCleanup);
    }
  });
}
