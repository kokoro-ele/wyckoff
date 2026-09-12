import { Hono } from "hono";
import * as sessions from "../services/sessions.js";

export const sessionRoutes = new Hono();

sessionRoutes.get("/", (c) => c.json({ sessions: sessions.listSessions(c.req.query("symbol")) }));

sessionRoutes.get("/:id/messages", (c) => c.json({ messages: sessions.getMessages(c.req.param("id")) }));

sessionRoutes.delete("/:id", (c) => {
  sessions.deleteSession(c.req.param("id"));
  return c.json({ ok: true });
});
