import { config } from "../config.js";
import { getState, setState } from "../db/index.js";
import { isRecommendRunning, runDailyRecommend } from "./recommend.js";

const LAST_RUN_KEY = "recommend_last_ny_date";

function zonedParts(timeZone: string): { y: number; m: number; d: number; hour: number; minute: number; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    y: Number(pick("year")),
    m: Number(pick("month")),
    d: Number(pick("day")),
    hour: Number(pick("hour")),
    minute: Number(pick("minute")),
    weekday: pick("weekday"),
  };
}

function todayKey(parts: { y: number; m: number; d: number }): string {
  return `${parts.y}-${String(parts.m).padStart(2, "0")}-${String(parts.d).padStart(2, "0")}`;
}

export function startRecommendScheduler(): void {
  if (!config.recommend.enabled) {
    console.log("[recommend] 定时任务已关闭（RECOMMEND_ENABLED=0）");
    return;
  }

  const tick = () => {
    const parts = zonedParts(config.recommend.timezone);
    if (parts.weekday === "Sat" || parts.weekday === "Sun") return;
    const due =
      parts.hour > config.recommend.hour ||
      (parts.hour === config.recommend.hour && parts.minute >= config.recommend.minute);
    if (!due) return;

    const key = todayKey(parts);
    if (getState(LAST_RUN_KEY) === key) return;
    if (isRecommendRunning()) return;

    setState(LAST_RUN_KEY, key);
    console.log(`[recommend] 定时触发 ${key} ${config.recommend.timezone} ${config.recommend.hour}:${String(config.recommend.minute).padStart(2, "0")}`);
    void runDailyRecommend("cron").catch((error: unknown) => {
      console.error("[recommend] 定时任务失败：", (error as Error).message);
      setState(LAST_RUN_KEY, "");
    });
  };

  tick();
  setInterval(tick, 60_000);
  console.log(
    `[recommend] 已挂载：每个交易日 ${config.recommend.timezone} ${config.recommend.hour}:${String(config.recommend.minute).padStart(2, "0")} 跑一次美股舆情荐股`,
  );
}
