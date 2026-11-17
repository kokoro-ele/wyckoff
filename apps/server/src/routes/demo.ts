import { createHash } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { renderFeatureSummary } from "@wyckoff/wyckoff";
import { getPool } from "../cloud/postgres.js";
import { getOpenAiClient } from "../llm/client.js";
import { resolveLlmSettings } from "../llm/settings.js";
import { getInstrument } from "../services/instruments.js";
import { getFeatures, getKlines } from "../services/market.js";
import { computeStrategy } from "../services/research.js";
import { consumeRateLimit } from "../credits/rateLimit.js";

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
  const rawMessage = completion.choices[0]?.message as { content?: string | null; reasoning_content?: string | null } | undefined;
  const answer = (rawMessage?.content || "").trim();
  if (!answer) return c.json({ code: "DEMO_FAILED", message: "Demo generation failed" }, 502);

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
