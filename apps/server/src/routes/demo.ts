import { createHash, randomUUID } from "node:crypto";
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
import { consumeRateLimit, releaseRateLimit } from "../credits/rateLimit.js";
import { runAgent } from "../agent/run.js";
import { workspaceContext } from "../cloud/context.js";
import { saveAgentTradePlan } from "../services/tradePlan.js";

const demoRequestSchema = z.object({
  symbol: z.string().min(1).max(32),
  period: z.enum(["1d", "1w", "1M", "1Q", "1Y"]).default("1d"),
  adjust: z.enum(["forward", "backward", "none"]).default("forward"),
  language: z.enum(["zh", "en"]).default("en"),
  question: z.string().max(500).optional(),
});

export const demoRoutes = new Hono();

const DEMO_WINDOW_MS = 24 * 60 * 60_000;

function ipKey(headers: Headers): string {
  // Vercel sets x-real-ip / x-vercel-forwarded-for itself; a client-supplied
  // x-forwarded-for prefix must not let a caller choose its own rate-limit key.
  const ip =
    headers.get("x-real-ip")?.trim() ||
    headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ||
    "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

function fallbackTradePlan(
  symbol: string,
  period: Parameters<typeof saveAgentTradePlan>[1],
  adjust: Parameters<typeof saveAgentTradePlan>[2],
  strategy: ReturnType<typeof computeStrategy>,
) {
  return saveAgentTradePlan(symbol, period, adjust, {
    bias: strategy.bias,
    trigger: `${strategy.trigger.kind} ${strategy.trigger.price ?? ""}`.trim(),
    triggerCondition: strategy.trigger.price
      ? { direction: strategy.trigger.kind === "breakdown" ? "below" : "above", price: strategy.trigger.price }
      : null,
    invalidationCondition: {
      direction: strategy.invalidation.kind === "closeAbove" ? "above" : "below",
      price: strategy.invalidation.price ?? strategy.stop ?? 0,
    },
    entryLow: strategy.entryLow,
    entryHigh: strategy.entryHigh,
    stop: strategy.stop,
    target1: strategy.target1,
    target2: strategy.target2,
    riskReward: strategy.riskReward,
    invalidation: `${strategy.invalidation.kind === "closeAbove" ? "Daily close above" : "Daily close below"} ${strategy.invalidation.price}`,
    support: strategy.support.map((level) => level.price),
    resistance: strategy.resistance.map((level) => level.price),
    note: "Fallback plan computed from the same deterministic ranges and swing structure as the research panel.",
  });
}

function fallbackText(plan: ReturnType<typeof fallbackTradePlan>, language: "zh" | "en"): string {
  return language === "en"
    ? `**Structure.** The active structure gives a ${plan.bias} bias. The deterministic reference levels are: entry ${plan.entryLow}–${plan.entryHigh}, stop ${plan.stop}, targets ${plan.target1} / ${plan.target2}.\n\n**Invalidation.** ${plan.invalidation}.\n\nThis is a conditional research scenario, not a prediction or investment advice.`
    : `**结构。** 当前结构偏向 **${plan.bias}**。可核对的参考价位：入场 ${plan.entryLow}–${plan.entryHigh}，止损 ${plan.stop}，目标 ${plan.target1} / ${plan.target2}。\n\n**失效条件。** ${plan.invalidation}。\n\n这是条件情景，不是预测或投资建议。`;
}

demoRoutes.post("/analysis", async (c) => {
  const parsed = demoRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ code: "BAD_REQUEST", message: "参数错误" }, 400);
  if (!resolveLlmSettings().apiKey) {
    return c.json({ code: "DEMO_UNAVAILABLE", message: "Demo analysis is not configured" }, 503);
  }

  // Consume the trial BEFORE any model call: a rejected request must cost nothing.
  const limitKey = `demo:${ipKey(c.req.raw.headers)}`;
  if (!(await consumeRateLimit(getPool(), limitKey, 1, DEMO_WINDOW_MS))) {
    return c.json({ code: "DEMO_USED", message: "The free demo is already used. Create an account to continue." }, 429);
  }
  const { symbol, period, adjust, language, question } = parsed.data;
  const instrument = await getInstrument(symbol);
  if (!instrument) {
    await releaseRateLimit(getPool(), limitKey, DEMO_WINDOW_MS);
    return c.json({ code: "NOT_FOUND", message: "Instrument not found" }, 404);
  }
  const klines = await getKlines({ symbol, period, adjust });
  if (klines.length === 0) {
    await releaseRateLimit(getPool(), limitKey, DEMO_WINDOW_MS);
    return c.json({ code: "NO_DATA", message: "No market data" }, 404);
  }
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
  // A model outage should not burn the visitor's one preview.
  if (!generated) await releaseRateLimit(getPool(), limitKey, DEMO_WINDOW_MS);
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
  const allowed = await consumeRateLimit(getPool(), `demo:${ipKey(c.req.raw.headers)}`, 1, DEMO_WINDOW_MS);
  if (!allowed) {
    return c.json({ code: "DEMO_USED", message: "The free demo is already used. Create an account to continue." }, 429);
  }
  const context = workspaceContext.getStore();
  if (context) context.signal = c.req.raw.signal;
  const { symbol, period, adjust, language } = parsed.data;
  const instrument = await getInstrument(symbol);
  const klines = await getKlines({ symbol, period, adjust });
  if (!instrument || klines.length === 0) {
    return c.json({ code: "NO_DATA", message: "No market data" }, 404);
  }
  const features = await getFeatures({ symbol, period, adjust }, { skipBenchmark: true });
  const deterministicPlan = fallbackTradePlan(symbol, period, adjust, computeStrategy(features, klines));
  return streamSSE(c, async (stream) => {
    let sawDone = false;
    let sawPlan = false;
    let streamedText = "";
    try {
      for await (const event of runAgent(
        { ...parsed.data, showTrace: false },
        c.req.raw.signal,
        undefined,
        { ephemeral: true },
      )) {
        if (event.type === "usage") continue;
        if (event.type === "done") sawDone = true;
        if (event.type === "trade_plan") sawPlan = true;
        if (event.type === "text") streamedText += event.delta;
        // If the agent fails after drawing/thinking, replace its terminal error
        // with a deterministic result instead of leaving the guest with nothing.
        if (event.type === "error") continue;
        await stream.writeSSE({ data: JSON.stringify(event) });
      }
    } catch (error) {
      console.error("[demo] guest agent failed:", error instanceof Error ? error.message : error);
    }
    const fallback = fallbackText(deterministicPlan, language);
    if (!sawPlan) {
      await stream.writeSSE({ data: JSON.stringify({ type: "trade_plan", plan: deterministicPlan }) });
    }
    // A model can finish a tool loop with only an opening sentence. In that
    // case append the deterministic reference levels so the guest still gets
    // a usable, checkable result.
    if (streamedText.trim().length < 240) {
      const separator = streamedText.trim() ? "\n\n" : "";
      await stream.writeSSE({ data: JSON.stringify({ type: "text", delta: `${separator}${fallback}` }) });
    }
    if (!sawDone) {
      const text = streamedText.trim() ? `${streamedText}\n\n${fallback}` : fallback;
      await stream.writeSSE({
        data: JSON.stringify({ type: "done", messageId: randomUUID(), content: text }),
      });
    }
  });
});
