import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config, isFreeTier, isLlmConfigured } from "./config.js";
import { annotationRoutes } from "./routes/annotations.js";
import { backtestRoutes } from "./routes/backtests.js";
import { aiBacktestRoutes } from "./routes/aiBacktests.js";
import { chatRoutes } from "./routes/chat.js";
import { libraryRoutes } from "./routes/library.js";
import { marketRoutes } from "./routes/market.js";
import { recommendRoutes } from "./routes/recommend.js";
import { settingsRoutes } from "./routes/settings.js";
import { sessionRoutes } from "./routes/sessions.js";
import { indexSize, isSyncNeeded, loadIndex, syncInstruments } from "./services/instruments.js";
import { startRecommendScheduler } from "./jobs/scheduler.js";
import { recoverInterruptedAiWyckoffBacktests } from "./jobs/aiBacktest.js";

const app = new Hono();

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    tickflow: { baseUrl: config.tickflow.baseUrl, freeTier: isFreeTier },
    llm: { configured: isLlmConfigured, model: config.llm.model },
    recommend: { enabled: config.recommend.enabled, timezone: config.recommend.timezone },
    instruments: indexSize(),
  }),
);

app.route("/api", marketRoutes);
app.route("/api", libraryRoutes);
app.route("/api", recommendRoutes);
app.route("/api/backtests", backtestRoutes);
app.route("/api/wyckoff-ai-backtests", aiBacktestRoutes);
app.route("/api/annotations", annotationRoutes);
app.route("/api/sessions", sessionRoutes);
app.route("/api/chat", chatRoutes);
app.route("/api/settings", settingsRoutes);

app.notFound((c) => c.json({ code: "NOT_FOUND", message: "接口不存在" }, 404));

app.onError((error, c) => {
  console.error("[server] 未捕获的错误：", error);
  return c.json({ code: "INTERNAL", message: error.message }, 500);
});

loadIndex();
const interruptedAiRuns = recoverInterruptedAiWyckoffBacktests();
if (interruptedAiRuns > 0) console.warn(`[ai-backtest] 已将 ${interruptedAiRuns} 个因服务重启中断的任务标记为失败`);

serve({ fetch: app.fetch, port: config.port, hostname: "127.0.0.1" }, (info) => {
  console.log(`[server] 监听 http://127.0.0.1:${info.port}`);
  console.log(`[server] 行情源 ${config.tickflow.baseUrl}${isFreeTier ? "（免费档：仅日线及以上）" : "（完整服务）"}`);
  if (!isLlmConfigured) {
    console.warn("[server] 未配置 OPENAI_API_KEY，Agent 对话功能不可用。请复制 .env.example 为 .env 后填写。");
  }
  console.log(`[server] 本地标的索引 ${indexSize()} 条`);

  // 标的清单是搜索的基础，缺失或过期时在后台补齐，不阻塞服务启动。
  if (isSyncNeeded()) {
    void syncInstruments().catch((error: unknown) => {
      console.error("[server] 标的同步失败：", (error as Error).message);
    });
  }
  startRecommendScheduler();
});
