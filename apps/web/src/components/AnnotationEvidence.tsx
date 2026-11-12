import { X } from "lucide-react";
import { WYCKOFF_EVENTS, type StoredAnnotation } from "@wyckoff/shared";
import type { KLineData } from "klinecharts";
import { useI18n } from "@/i18n.js";
import { formatDate, formatPrice } from "@/lib/utils.js";

export interface AnnotationStats {
  volumeRatio: number | null;
  spreadRatio: number | null;
  closePosition: number | null;
  changePct: number | null;
}

const CONFIDENCE = {
  zh: { confirmed: "已确认", probable: "方向合理", unconfirmed: "尚未确认" },
  en: { confirmed: "Confirmed", probable: "Probable", unconfirmed: "Unconfirmed" },
} as const;

export function AnnotationEvidence({
  annotation,
  bar,
  stats,
  onClose,
}: {
  annotation: StoredAnnotation;
  bar?: KLineData;
  stats?: AnnotationStats;
  onClose: () => void;
}) {
  const { lang } = useI18n();
  const zh = lang === "zh";
  const event = annotation.kind === "event" ? WYCKOFF_EVENTS[annotation.code] : null;
  const confidence = annotation.confidence ? CONFIDENCE[lang][annotation.confidence] : null;
  const title =
    annotation.kind === "event"
      ? `${annotation.code} · ${zh ? event?.nameZh ?? "" : event?.nameEn ?? ""}`
      : annotation.kind === "zone"
        ? annotation.label
        : annotation.kind === "level"
          ? annotation.label
          : annotation.label;
  const date = annotation.kind === "event"
    ? annotation.timestamp
    : annotation.kind === "zone"
      ? annotation.endTime
      : annotation.kind === "level"
        ? annotation.endTime ?? annotation.startTime
        : annotation.points[1].timestamp;

  return (
    <aside className="annotation-evidence hand-card" role="dialog" aria-label={title}>
      <button type="button" className="hand-icon annotation-evidence-close" onClick={onClose} aria-label={zh ? "关闭" : "Close"}><X size={14} /></button>
      <div className="annotation-evidence-kicker">{zh ? "判读证据" : "EVIDENCE"}</div>
      <div className="annotation-evidence-title">
        <strong>{title}</strong>
        {confidence && <span className={`annotation-confidence ${annotation.confidence}`}>{confidence}</span>}
      </div>
      <div className="annotation-evidence-meta">
        {date ? <span>{formatDate(date)}</span> : null}
        {annotation.kind === "event" ? <span>{formatPrice(annotation.price)}</span> : null}
        {annotation.kind === "zone" ? <span>{formatPrice(annotation.low)}–{formatPrice(annotation.high)}</span> : null}
        {annotation.kind === "level" ? <span>{formatPrice(annotation.price)}</span> : null}
      </div>

      {bar && annotation.kind === "event" && (
        <div className="annotation-evidence-stats">
          <Stat label={zh ? "收盘 / 涨跌" : "Close / change"} value={`${formatPrice(bar.close)} / ${stats?.changePct === null || stats?.changePct === undefined ? "—" : `${stats.changePct >= 0 ? "+" : ""}${stats.changePct.toFixed(2)}%`}`} />
          <Stat label={zh ? "量比" : "Volume ratio"} value={stats?.volumeRatio === null || stats?.volumeRatio === undefined ? "—" : `${stats.volumeRatio.toFixed(2)}×`} />
          <Stat label={zh ? "价差比" : "Spread ratio"} value={stats?.spreadRatio === null || stats?.spreadRatio === undefined ? "—" : `${stats.spreadRatio.toFixed(2)}×`} />
          <Stat label={zh ? "收盘位置" : "Close position"} value={stats?.closePosition === null || stats?.closePosition === undefined ? "—" : stats.closePosition.toFixed(2)} />
        </div>
      )}

      <EvidenceList title={zh ? "支持证据" : "Supporting evidence"} items={annotation.evidence} fallback={annotation.note ?? (zh ? "Agent 未提供结构化证据。" : "No structured evidence.")} />
      <EvidenceList title={zh ? "反例 / 不确定" : "Counter-evidence"} items={annotation.counterEvidence} fallback={zh ? "Agent 未提供明确反例；这仍是结构判读，不是确认信号。" : "No explicit counter-evidence; this remains an interpretation, not a confirmation."} />

      {annotation.kind === "zone" && (
        <p className="annotation-evidence-foot">
          {zh ? `区间内 ${annotation.startTime === annotation.endTime ? "1" : "多"} 根 K 线；阶段 ${annotation.phase ?? "未确认"}。` : `Phase ${annotation.phase ?? "unconfirmed"}; range is a hypothesis, not a guarantee.`}
        </p>
      )}
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong className="font-mono">{value}</strong></div>;
}

function EvidenceList({ title, items, fallback }: { title: string; items?: string[]; fallback: string }) {
  return (
    <section className="annotation-evidence-list">
      <h4>{title}</h4>
      {items?.length ? (
        <ul>{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
      ) : (
        <p>{fallback}</p>
      )}
    </section>
  );
}
