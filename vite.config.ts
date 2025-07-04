// File: vite.config.ts
import { defineConfig } from "vite";

// Convert the export to a function to access the command
export default defineConfig(({ command }) => {
  const isProduction = command === "build";

  return {
    root: ".",
    base: isProduction ? "./" : "/",
    build: {
      outDir: "dist/public",
      emptyOutDir: true,
    },
    server: {
      proxy: {
        // --- START OF FIX ---
        // A single, clean proxy for ALL API calls.
        "/api": {
          target: "http://localhost:42069",
          changeOrigin: true,
        },
        // WebSocket proxy remains separate.
        "/ws": {
          target: "ws://localhost:42069",
          ws: true,
        },
        // --- END OF FIX ---
      },
    },
    css: {
      modules: {
        localsConvention: "camelCaseOnly",
      },
    },
  };
});
