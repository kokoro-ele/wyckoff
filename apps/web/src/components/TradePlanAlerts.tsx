import { useEffect, useState } from "react";
import { Bell, Check } from "lucide-react";
import type { AdjustType, AgentTradePlan, Period } from "@wyckoff/shared";
import * as api from "@/lib/api.js";
import { useWorkbench } from "@/store.js";
import { useI18n } from "@/i18n.js";
import { formatPrice } from "@/lib/utils.js";

export function TradePlanAlerts({
  symbol,
  period,
  adjust,
}: {
  symbol: string;
  period: Period;
  adjust: AdjustType;
}) {
  const { t, lang } = useI18n();
  const notify = useWorkbench((s) => s.notify);
  const [plan, setPlan] = useState<AgentTradePlan | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [created, setCreated] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    setCreated([]);
    void api.fetchTradePlan({ symbol, period, adjust })
      .then(({ plan: value }) => { if (!cancelled) setPlan(value); })
      .catch(() => { if (!cancelled) setPlan(null); });
    return () => { cancelled = true; };
  }, [symbol, period, adjust]);

  if (!plan) return null;
  const targets = [
    { index: 1, price: plan.target1 },
    { index: 2, price: plan.target2 },
  ].filter((target): target is { index: number; price: number } => target.price !== null && Number.isFinite(target.price));
  if (targets.length === 0) return null;

  const setAlert = async (target: { index: number; price: number }) => {
    if (busy !== null) return;
    setBusy(target.index);
    try {
      const result = await api.createPriceAlert({
        symbol,
        period,
        adjust,
        targetPrice: target.price,
        label: `T${target.index} ${formatPrice(target.price)}`,
        language: lang,
      });
      setCreated((current) => current.includes(target.index) ? current : [...current, target.index]);
      notify(t(result.duplicate ? "alerts.duplicate" : "alerts.created", { price: formatPrice(target.price) }), "info");
    } catch (error) {
      notify(error instanceof Error ? error.message : t("alerts.error"), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="trade-plan-alerts" aria-label={t("alerts.title")}>
      <div className="trade-plan-alerts-label">
        <Bell size={12} />
        {t("alerts.title")}
      </div>
      <div className="trade-plan-alert-buttons">
        {targets.map((target) => {
          const done = created.includes(target.index);
          return (
            <button
              key={target.index}
              type="button"
              className={done ? "trade-plan-alert is-done" : "trade-plan-alert"}
              disabled={busy !== null || done}
              onClick={() => void setAlert(target)}
            >
              {done ? <Check size={11} /> : <Bell size={11} />}
              {done ? t("alerts.set", { n: target.index }) : t("alerts.action", { n: target.index, price: formatPrice(target.price) })}
            </button>
          );
        })}
      </div>
    </div>
  );
}
