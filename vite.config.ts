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
      // This is the key part for development.
      // It proxies API requests from the Vite dev server to your Elysia backend.
      proxy: {
        // This one is for tRPC API calls
        "/trpc": {
          target: "http://localhost:42069", // Your Elysia backend URL
          changeOrigin: true,
        }, // FIX: Add this new entry for the client-side logging endpoint
        "/log/client": {
          target: "http://localhost:42069",
          changeOrigin: true,
        },
        // --- ADD THIS BLOCK ---
        // This proxies any request starting with /api to your backend
        "/api": {
          target: "http://localhost:42069",
          changeOrigin: true,
        },
        // --- END OF ADDITION ---
      },
    },
  };
});
