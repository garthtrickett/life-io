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
        // The specific proxy for /api/log/client has been removed.
        // All API requests, including tRPC calls to /api/trpc/*,
        // will now be handled by the general /api rule.
        "/api": {
          target: "http://localhost:42069",
          changeOrigin: true,
        },
        // WebSocket proxy remains separate.
        "/ws": {
          target: "ws://localhost:42069",
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
