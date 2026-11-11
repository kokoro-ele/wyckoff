import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const SERVER_PORT = process.env.PORT ?? "8787";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5273,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${SERVER_PORT}`,
        // Keep the browser's Host so Origin/Host checks and Better Auth's
        // canonical BETTER_AUTH_URL agree during local development.
        changeOrigin: false,
        // Let Better Auth resolve a per-client rate-limit bucket in local dev.
        xfwd: true,
      },
    },
  },
});
