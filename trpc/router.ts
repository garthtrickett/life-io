// FILE: trpc/router.ts
import { router } from "./trpc";
import { noteRouter } from "./routers/note";
import { authRouter } from "./routers/auth";
import { logRouter } from "./routers/log";

/**
 * This is the main router for your tRPC API.
 * All sub-routers are merged here.
 */
export const appRouter = router({
  note: noteRouter,
  auth: authRouter,
  log: logRouter,
});

// Export the type of your AppRouter. This is the crucial part
// that the frontend imports for type safety.
export type AppRouter = typeof appRouter;
