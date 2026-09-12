import { Hono } from "hono";
import { z } from "zod";
import { indexSize, isSyncNeeded, searchInstruments, syncInstruments } from "../services/instruments.js";
import * as watchlist from "../services/watchlist.js";

/** 标的检索与收藏。 */
export const libraryRoutes = new Hono();

libraryRoutes.get("/search", (c) => {
  const q = c.req.query("q") ?? "";
  const limit = Number(c.req.query("limit") ?? 30);
  return c.json({
    results: searchInstruments(q, Number.isFinite(limit) ? Math.min(limit, 100) : 30),
    indexSize: indexSize(),
    syncing: isSyncNeeded(),
  });
});

libraryRoutes.post("/search/resync", async (c) => {
  await syncInstruments();
  return c.json({ ok: true, indexSize: indexSize() });
});

libraryRoutes.get("/watchlist", (c) =>
  c.json({ groups: watchlist.listGroups(), items: watchlist.listItems() }),
);

const addSchema = z.object({ symbol: z.string().min(1), groupId: z.number().int().optional() });

libraryRoutes.post("/watchlist/items", async (c) => {
  const parsed = addSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ code: "BAD_REQUEST", message: "参数错误" }, 400);

    const groupId = parsed.data.groupId ?? watchlist.listGroups()[0]?.id;
    if (groupId === undefined) return c.json({ code: "NO_GROUP", message: "没有可用的收藏分组" }, 400);
    if (watchlist.isManagedGroup(groupId)) {
      return c.json({ code: "MANAGED_GROUP", message: "该分组由荐股系统管理，不能手动添加" }, 409);
    }

  watchlist.addItem(parsed.data.symbol, groupId);
  return c.json({ groups: watchlist.listGroups(), items: watchlist.listItems() });
});

libraryRoutes.delete("/watchlist/items/:symbol", (c) => {
    const groupId = Number(c.req.query("groupId"));
    if (Number.isFinite(groupId)) {
      if (watchlist.isManagedGroup(groupId)) {
        return c.json({ code: "MANAGED_GROUP", message: "该分组由荐股系统管理，不能手动移除" }, 409);
      }
      watchlist.removeItem(c.req.param("symbol"), groupId);
    } else {
      // 未指定分组时，从所有分组里移除。
      for (const group of watchlist.listGroups()) {
        if (!group.managed) watchlist.removeItem(c.req.param("symbol"), group.id);
      }
  }
  return c.json({ groups: watchlist.listGroups(), items: watchlist.listItems() });
});

libraryRoutes.post("/watchlist/groups", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { name?: string };
  const name = body.name?.trim();
  if (!name) return c.json({ code: "BAD_REQUEST", message: "分组名不能为空" }, 400);
  watchlist.createGroup(name);
  return c.json({ groups: watchlist.listGroups(), items: watchlist.listItems() });
});

libraryRoutes.patch("/watchlist/groups/:id", async (c) => {
  const groupId = Number(c.req.param("id"));
  if (watchlist.isManagedGroup(groupId)) {
    return c.json({ code: "MANAGED_GROUP", message: "系统托管分组不能重命名" }, 409);
  }
  const body = (await c.req.json().catch(() => ({}))) as { name?: string };
  if (body.name?.trim()) watchlist.renameGroup(groupId, body.name.trim());
  return c.json({ groups: watchlist.listGroups(), items: watchlist.listItems() });
});

libraryRoutes.delete("/watchlist/groups/:id", (c) => {
  const groupId = Number(c.req.param("id"));
  if (watchlist.isManagedGroup(groupId)) {
    return c.json({ code: "MANAGED_GROUP", message: "系统托管分组不能删除" }, 409);
  }
  watchlist.deleteGroup(groupId);
  return c.json({ groups: watchlist.listGroups(), items: watchlist.listItems() });
});

const reorderSchema = z.object({ groupId: z.number().int(), symbols: z.array(z.string()) });

libraryRoutes.post("/watchlist/reorder", async (c) => {
  const parsed = reorderSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ code: "BAD_REQUEST", message: "参数错误" }, 400);
  if (watchlist.isManagedGroup(parsed.data.groupId)) {
    return c.json({ code: "MANAGED_GROUP", message: "系统托管分组不能手动排序" }, 409);
  }
  watchlist.reorderItems(parsed.data.groupId, parsed.data.symbols);
  return c.json({ groups: watchlist.listGroups(), items: watchlist.listItems() });
});
