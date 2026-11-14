import { Hono } from "hono";
import { getNewsHeadlines } from "../services/news.js";

export const newsRoutes = new Hono();

newsRoutes.get("/headlines", async (c) => {
  const language = c.req.query("lang") === "en" ? "en" : "zh";
  return c.json(await getNewsHeadlines(language));
});
