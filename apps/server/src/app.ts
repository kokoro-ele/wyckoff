import { Hono } from "hono";
import { config, isFreeTier, hasLlmConfiguration } from "./config.js";
import { adminRoutes } from "./routes/admin.js";
import { annotationRoutes } from "./routes/annotations.js";
import { chatRoutes } from "./routes/chat.js";
import { libraryRoutes } from "./routes/library.js";
import { marketRoutes } from "./routes/market.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { researchRoutes } from "./routes/research.js";
import { settingsRoutes } from "./routes/settings.js";
import { tradePlanRoutes } from "./routes/tradePlan.js";
import { sessionRoutes } from "./routes/sessions.js";
import { indexSize } from "./services/instruments.js";

export const app = new Hono();

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    tickflow: { baseUrl: config.tickflow.baseUrl, freeTier: isFreeTier },
    llm: { configured: hasLlmConfiguration(), model: config.llm.model },
    instruments: indexSize(),
  }),
);

app.route("/api", marketRoutes);
app.route("/api/research", researchRoutes);
app.route("/api", libraryRoutes);
app.route("/api/annotations", annotationRoutes);
app.route("/api/sessions", sessionRoutes);
app.route("/api/settings", settingsRoutes);
app.route("/api/trade-plan", tradePlanRoutes);
app.route("/api/onboarding", onboardingRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/chat", chatRoutes);

app.notFound((c) => c.json({ code: "NOT_FOUND", message: "接口不存在" }, 404));

app.onError((error, c) => {
  console.error("[server] 未捕获的错误：", error);
  return c.json({ code: "INTERNAL", message: "服务内部错误" }, 500);
});

