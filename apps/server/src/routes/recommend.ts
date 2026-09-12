import { Hono } from "hono";
import { isLlmConfigured } from "../config.js";
import { enrichBookPrices, isRecommendRunning, runDailyRecommend } from "../jobs/recommend.js";
import * as store from "../services/recommendStore.js";

export const recommendRoutes = new Hono();

recommendRoutes.get("/recommend", async (c) => {
  const book = await enrichBookPrices(store.listBook());
  return c.json({
    running: isRecommendRunning(),
    lastRun: store.latestRun(),
    book,
    history: store.listHistory(),
    runs: store.listRuns(),
  });
});

recommendRoutes.post("/recommend/run", (c) => {
  if (!isLlmConfigured) return c.json({ code: "NO_LLM", message: "未配置 OPENAI_API_KEY" }, 400);
  if (isRecommendRunning()) return c.json({ code: "BUSY", message: "荐股任务正在运行" }, 409);

  void runDailyRecommend("manual").catch((error: unknown) => {
    console.error("[recommend] 手动扫描失败：", (error as Error).message);
  });
  return c.json({ started: true, running: true }, 202);
});
