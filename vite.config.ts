// File: vite.config.ts
import { defineConfig } from "vite";

// Convert the export to a function to access the command
export default defineConfig(({ command }) => {
  const isProduction = command === "build";

  return {
    // The 'root' is where your index.html is located.
    root: ".", // FIX: Use absolute base for dev server, relative for production build.
    // Dev server needs '/' to handle history-based SPA routing correctly.
    // The build needs './' so the generated assets work when served by Elysia.

    base: isProduction ? "./" : "/",

    build: {
      // The output directory for the production build.
      // We change this to 'dist/public' to match what our server will serve.
      outDir: "dist/public", // We want to see the build output in the console.
      emptyOutDir: true,
    },
    server: {
      proxy: {
        // This one is for tRPC API calls
        "/trpc": {
          target: "http://localhost:42069", // Your Elysia backend URL
          changeOrigin: true,
        },
        "/log/client": {
          target: "http://localhost:42069",
          changeOrigin: true,
        },
        "/api": {
          target: "http://localhost:42069",
          changeOrigin: true,
        },
        "/replicache": {
          target: "http://localhost:42069",
          changeOrigin: true,
        },

        // --- FIX IS HERE ---
        "/ws": {
          // 1. The target must use the 'ws://' protocol for WebSockets.
          target: "ws://localhost:42069",
          // 2. You must explicitly enable WebSocket proxying.
          ws: true,
        },
      },
    },
    css: {
      modules: {
        localsConvention: "camelCaseOnly",
      },
    },
  };
});
