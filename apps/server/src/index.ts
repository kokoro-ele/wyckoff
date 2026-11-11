import { cloudFetch } from "./cloud/handler.js";
import { serve } from "@hono/node-server";
import { config } from "./config.js";
// All entry points require the same verified account and credit checks.
serve({ fetch: cloudFetch, port: config.port, hostname: "127.0.0.1" }, () => {
  console.log(`[server] http://127.0.0.1:${config.port}`);
});
