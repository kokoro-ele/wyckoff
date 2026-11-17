import { createHash } from "node:crypto";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { bodyLimit } from "hono/body-limit";
import { chatRequestSchema } from "@wyckoff/shared";
import { z } from "zod";
import { renderFeatureSummary } from "@wyckoff/wyckoff";
import { getPool } from "../cloud/postgres.js";
import { getOpenAiClient } from "../llm/client.js";
import { resolveLlmSettings } from "../llm/settings.js";
import { getInstrument } from "../services/instruments.js";
import { getFeatures, getKlines } from "../services/market.js";
import { computeStrategy } from "../services/research.js";
import { consumeRateLimit } from "../credits/rateLimit.js";
import { runAgent } from "../agent/run.js";
import { workspaceContext } from "../cloud/context.js";

const demoRequestSchema = z.object({
  symbol: z.string().min(1).max(32),
  period: z.enum(["1d", "1w", "1M", "1Q", "1Y"]).default("1d"),
  adjust: z.enum(["forward", "backward", "none"]).default("forward"),
  language: z.enum(["zh", "en"]).default("en"),
  question: z.string().max(500).optional(),
});

export const demoRoutes = new Hono();

function ipKey(headers: Headers): string {
  const ip =
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

demoRoutes.post("/analysis", async (c) => {
  const parsed = demoRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ code: "BAD_REQUEST", message: "参数错误" }, 400);
  if (!resolveLlmSettings().apiKey) {
    return c.json({ code: "DEMO_UNAVAILABLE", message: "Demo analysis is not configured" }, 503);
  }

  const { symbol, period, adjust, language, question } = parsed.data;
  const instrument = await getInstrument(symbol);
  if (!instrument) return c.json({ code: "NOT_FOUND", message: "Instrument not found" }, 404);
  const klines = await getKlines({ symbol, period, adjust });
  if (klines.length === 0) return c.json({ code: "NO_DATA", message: "No market data" }, 404);
  const features = await getFeatures({ symbol, period, adjust }, { skipBenchmark: true });
  const plan = computeStrategy(features, klines);
  const summary = renderFeatureSummary(features);
  const languageRule =
    language === "en"
      ? "Write in English. Keep Wyckoff event codes in English."
      : "用中文回答，Wyckoff 事件代号保留英文缩写。";
  const prompt = `You are a careful Wyckoff market-structure analyst. This is a one-time anonymous demo, so use only the data below and do not claim to have searched the web.

${languageRule}
Instrument: ${instrument.symbol} ${instrument.name ?? ""}
Period: ${period}. The latest close is ${klines[klines.length - 1].close}.

Feature summary:
${summary}

Deterministic trade-plan levels:
${JSON.stringify(plan, null, 2)}

User question: ${question?.trim() || "Explain the current structure and what would confirm or invalidate it."}

Return a compact analysis with these sections:
1. Structure — phase/range and the key evidence.
2. Base case — trigger, what to watch, and why.
3. Alternative / invalidation — what would flip the view.
4. Key levels — support and resistance from the plan.
Do not invent news or fundamentals. Do not give a deterministic price prediction or investment advice. Keep it under 300 words.`;

  let generated = "";
  try {
    const completion = await getOpenAiClient().chat.completions.create({
      model: resolveLlmSettings().model,
      messages: [
        { role: "system", content: "You are a Wyckoff research assistant. Be concise, evidence-led and honest about uncertainty." },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      // Some gateways use reasoning tokens before emitting content; 700 can
      // leave the visible answer empty even though the request succeeds.
      max_tokens: 2_000,
    });
    generated = completion.choices[0]?.message?.content?.trim() ?? "";
  } catch (error) {
    console.error("[demo] model failed:", error instanceof Error ? error.message : error);
  }
  const fallback =
    language === "en"
      ? `**Structure.** ${plan.range ? `The active reference range is ${plan.range.support}–${plan.range.resistance};` : "No clean active range was detected;"} the current bias from price structure is **${plan.bias}**.

**Base case.** A ${plan.trigger.kind} at ${plan.trigger.price ?? plan.entryLow} is the trigger to watch. The reference entry zone is ${plan.entryLow}–${plan.entryHigh}, with a stop at ${plan.stop} and targets at ${plan.target1} and ${plan.target2}.

**Invalidation.** A ${plan.invalidation.kind === "closeAbove" ? "daily close above" : "daily close below"} ${plan.invalidation.price} invalidates this structure.

This is a research scenario, not a prediction or investment advice.`
      : `**结构。** ${plan.range ? `当前参考区间为 ${plan.range.support}–${plan.range.resistance}；` : "未识别到清晰的活跃区间；"}量价结构给出的偏向是 **${plan.bias}**。\n\n**基准情景。** 观察 ${plan.trigger.kind} 触发价 ${plan.trigger.price ?? plan.entryLow}。参考入场区 ${plan.entryLow}–${plan.entryHigh}，止损 ${plan.stop}，目标 ${plan.target1} 和 ${plan.target2}。\n\n**失效条件。** 日线${plan.invalidation.kind === "closeAbove" ? "收于" : "跌破"} ${plan.invalidation.price} 上方/下方后，该结构失效。\n\n这是研究情景，不是预测或投资建议。`;
  const answer = generated || fallback;

  // Charge the free trial only after a usable answer exists. A model outage
  // should not burn the visitor's one preview.
  const allowed = await consumeRateLimit(getPool(), `demo:${ipKey(c.req.raw.headers)}`, 1, 24 * 60 * 60_000);
  if (!allowed) {
    return c.json({ code: "DEMO_USED", message: "The free demo is already used. Create an account to continue." }, 429);
  }
  return c.json({
    symbol: instrument.symbol,
    name: instrument.name,
    answer,
    plan,
    latestClose: klines[klines.length - 1].close,
    asOf: klines[klines.length - 1].timestamp,
  });
});

demoRoutes.post("/chat", bodyLimit({ maxSize: 1024 * 1024 }), async (c) => {
  const parsed = chatRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ code: "BAD_REQUEST", message: "参数错误" }, 400);
  if (!resolveLlmSettings().apiKey) {
    return c.json({ code: "DEMO_UNAVAILABLE", message: "Demo analysis is not configured" }, 503);
  }
  const allowed = await consumeRateLimit(getPool(), `demo:${ipKey(c.req.raw.headers)}`, 1, 24 * 60 * 60_000);
  if (!allowed) {
    return c.json({ code: "DEMO_USED", message: "The free demo is already used. Create an account to continue." }, 429);
  }
  const context = workspaceContext.getStore();
  if (context) context.signal = c.req.raw.signal;
  return streamSSE(c, async (stream) => {
    try {
      for await (const event of runAgent(
        { ...parsed.data, showTrace: false },
        c.req.raw.signal,
        undefined,
        { ephemeral: true },
      )) {
        if (event.type === "usage") continue;
        await stream.writeSSE({ data: JSON.stringify(event) });
      }
    } catch (error) {
      await stream.writeSSE({
        data: JSON.stringify({ type: "error", message: (error as Error).message || "Demo failed" }),
      });
    }
  });
});
