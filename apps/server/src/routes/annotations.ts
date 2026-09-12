import { annotationSchema, makeId } from "@wyckoff/shared";
import { Hono } from "hono";
import { z } from "zod";
import * as store from "../services/annotations.js";

export const annotationRoutes = new Hono();

annotationRoutes.get("/", (c) => {
  const symbol = c.req.query("symbol");
  const period = c.req.query("period") ?? "1d";
  if (!symbol) return c.json({ code: "BAD_REQUEST", message: "缺少 symbol" }, 400);
  return c.json(store.listAnnotations(symbol, period));
});

const saveSchema = z.object({
  symbol: z.string().min(1),
  period: z.string().default("1d"),
  title: z.string().default("手动标注"),
  groupId: z.string().optional(),
  annotations: z.array(annotationSchema),
});

/** 保存手绘标注。Agent 画的标注走对话流程，不经过这里。 */
annotationRoutes.post("/", async (c) => {
  const parsed = saveSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ code: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "参数错误" }, 400);
  }
  const { symbol, period, title, annotations } = parsed.data;
  const groupId = parsed.data.groupId ?? makeId("grp");
  const saved = store.saveAnnotationGroup({ groupId, symbol, period, title, annotations, source: "user" });
  return c.json({ groupId, annotations: saved });
});

annotationRoutes.patch("/:id", async (c) => {
  const patch = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const updated = store.updateAnnotation(c.req.param("id"), patch);
  if (!updated) return c.json({ code: "NOT_FOUND", message: "标注不存在" }, 404);
  return c.json({ annotation: updated });
});

annotationRoutes.delete("/:id", (c) => {
  store.deleteAnnotation(c.req.param("id"));
  return c.json({ ok: true });
});

annotationRoutes.delete("/groups/:groupId", (c) => {
  store.deleteAnnotationGroup(c.req.param("groupId"));
  return c.json({ ok: true });
});

annotationRoutes.patch("/groups/:groupId", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { visible?: boolean };
  if (typeof body.visible === "boolean") store.setGroupVisible(c.req.param("groupId"), body.visible);
  return c.json({ ok: true });
});

annotationRoutes.post("/clear", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { symbol?: string; period?: string; source?: "agent" | "user" };
  if (!body.symbol) return c.json({ code: "BAD_REQUEST", message: "缺少 symbol" }, 400);
  const removed = store.clearAnnotations(body.symbol, body.period ?? "1d", body.source);
  return c.json({ ok: true, removedGroups: removed });
});
