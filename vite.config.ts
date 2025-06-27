import { defineConfig } from "vite";

export default defineConfig({
  // The 'root' is where your index.html is located.
  root: ".",
  // Ensures asset paths in the built HTML are relative, e.g. "./assets/index.js"
  // This is crucial for the app to work correctly when served by Elysia.
  base: "./",
  build: {
    // The output directory for the production build.
    // We change this to 'dist/public' to match what our server will serve.
    outDir: "dist/public",
    // We want to see the build output in the console.
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
      },
      // FIX: Add this new entry for the client-side logging endpoint
      "/log/client": {
        target: "http://localhost:42069",
        changeOrigin: true,
      },
    },
  },
});
