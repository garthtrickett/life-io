// FILE: trpc/router.ts
import { router } from "./trpc";
import { noteRouter } from "./routers/note";

/**
 * This is the main router for your tRPC API.
 * All sub-routers (like noteRouter) are merged here.
 */
export const appRouter = router({
  // All procedures under `noteRouter` will be available
  // under the `note` namespace.
  // e.g., trpc.note.createNote.mutate(...)
  note: noteRouter,
});

// Export the type of your AppRouter. This is the crucial part
// that the frontend imports for type safety.
export type AppRouter = typeof appRouter;
