import { Hono } from "hono";
import { getState, setState } from "../db/index.js";

const KEY = "onboarding_v1";
export const onboardingRoutes = new Hono();

onboardingRoutes.get("/", (c) => c.json({ seen: getState(KEY) === "1" }));

onboardingRoutes.post("/complete", (c) => {
  setState(KEY, "1");
  return c.json({ ok: true });
});
