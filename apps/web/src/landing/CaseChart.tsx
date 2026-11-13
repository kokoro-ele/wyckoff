import { useEffect, useMemo, useState } from "react";
import type { Kline } from "@wyckoff/shared";
import { WYCKOFF_EVENTS } from "@wyckoff/shared";
import * as api from "@/lib/api.js";
import { formatDate, formatPrice } from "@/lib/utils.js";
import type { LandingCopy } from "./copy.js";
import type { CaseStudy } from "./cases.js";

type ChartCopy = LandingCopy["chart"];

function eventColor(code: string): string {
  const bias = WYCKOFF_EVENTS[code as keyof typeof WYCKOFF_EVENTS]?.bias;
  return bias === "bullish" ? "var(--color-up)" : bias === "bearish" ? "var(--color-down)" : "var(--color-warn)";
}

export function CaseChart({
  study,
  labels,
  zoneLabel,
}: {
  study: CaseStudy;
  labels: ChartCopy;
  zoneLabel: string;
}) {
  const [bars, setBars] = useState<Kline[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    void api
      .fetchKlines({
        symbol: study.symbol,
        period: "1d",
        adjust: "forward",
        startTime: Date.parse(`${study.chartFrom}T00:00:00Z`),
        endTime: Date.parse(`${study.chartTo}T00:00:00Z`),
      })
      .then(({ klines }) => {
        if (!cancelled) setBars(klines);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [study.symbol, study.chartFrom, study.chartTo]);

  const chart = useMemo(() => {
    if (bars.length < 2) return null;
    const width = 380;
    const height = 190;
    const pad = { left: 8, right: 46, top: 18, bottom: 22 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const t0 = bars[0].timestamp;
    const t1 = bars[bars.length - 1].timestamp;
    const allValues = [
      ...bars.flatMap((bar) => [bar.high, bar.low]),
      study.zone.support,
      study.zone.resistance,
      ...study.supports,
      ...study.resistances,
      ...study.events.map((event) => event.price),
    ].filter(Number.isFinite);
    let min = Math.min(...allValues);
    let max = Math.max(...allValues);
    const padding = Math.max((max - min) * 0.06, 0.01);
    min -= padding;
    max += padding;
    const x = (timestamp: number) => pad.left + ((timestamp - t0) / Math.max(t1 - t0, 1)) * plotW;
    const y = (price: number) => pad.top + ((max - price) / Math.max(max - min, 0.0001)) * plotH;
    const candleW = Math.max(1.1, Math.min(5, (plotW / bars.length) * 0.62));
    const zoneX0 = x(Date.parse(`${study.zone.from}T00:00:00Z`));
    const zoneX1 = x(Date.parse(`${study.zone.to}T00:00:00Z`));
    const zoneTop = y(study.zone.resistance);
    const zoneBottom = y(study.zone.support);
    // Follow a lightly smoothed close path so the pencil glides instead of
    // snapping to every candle. Keep its angle fixed: rotating with a jagged
    // price path makes it look like it is spinning.
    const smoothClose = (index: number) => {
      const radius = 4;
      const from = Math.max(0, index - radius);
      const to = Math.min(bars.length - 1, index + radius);
      let sum = 0;
      for (let i = from; i <= to; i += 1) sum += bars[i].close;
      return sum / (to - from + 1);
    };
    const pencilPath = bars
      .map((bar, index) => {
        const px = Math.min(x(bar.timestamp) + 10, width - pad.right - 4);
        return `${index === 0 ? "M" : "L"} ${px.toFixed(2)} ${(y(smoothClose(index)) - 8).toFixed(2)}`;
      })
      .join(" ");
    return { width, height, pad, plotW, plotH, x, y, candleW, zoneX0, zoneX1, zoneTop, zoneBottom, min, max, pencilPath };
  }, [bars, study]);

  if (error) {
    return (
      <div className="site-chart-empty" role="status">
        {labels.unavailable}
      </div>
    );
  }

  if (!chart || bars.length < 2) {
    return (
      <div className="site-chart-empty" role="status">
        {labels.loading}
      </div>
    );
  }

  const { width, height, pad, plotW, x, y, candleW, zoneX0, zoneX1, zoneTop, zoneBottom, min, max, pencilPath } = chart;
  const zoneWidth = Math.max(zoneX1 - zoneX0, 2);
  const zoneLabelText = `${zoneLabel} · ${labels.phase} ${study.zone.phase}`;

  return (
    <svg
      className="site-chart-svg"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${study.symbol} ${labels.range} ${study.zone.support}–${study.zone.resistance}`}
    >
      <rect x={zoneX0} y={Math.min(zoneTop, zoneBottom)} width={zoneWidth} height={Math.abs(zoneBottom - zoneTop)} className="site-chart-zone" />

      {study.supports.map((price, index) => (
        <line key={`support-${price}-${index}`} x1={pad.left} x2={pad.left + plotW} y1={y(price)} y2={y(price)} className="site-chart-support" />
      ))}
      {study.resistances.map((price, index) => (
        <line key={`resistance-${price}-${index}`} x1={pad.left} x2={pad.left + plotW} y1={y(price)} y2={y(price)} className="site-chart-resistance" />
      ))}

      {bars.map((bar) => {
        const left = x(bar.timestamp) - candleW / 2;
        const openY = y(bar.open);
        const closeY = y(bar.close);
        const highY = y(bar.high);
        const lowY = y(bar.low);
        const up = bar.close >= bar.open;
        return (
          <g key={bar.timestamp} className={up ? "site-candle-up" : "site-candle-down"}>
            <line x1={x(bar.timestamp)} x2={x(bar.timestamp)} y1={highY} y2={lowY} />
            <rect
              x={left}
              y={Math.min(openY, closeY)}
              width={candleW}
              height={Math.max(Math.abs(closeY - openY), 1)}
            />
          </g>
        );
      })}

      {(() => {
        const labelX = Math.max(pad.left + 3, zoneX0 + 4);
        const labelY = Math.max(pad.top + 9, Math.min(zoneTop, zoneBottom) - 4);
        const labelWidth = zoneLabelText.length * 5.6 + 8;
        return (
          <>
            <rect x={labelX - 3} y={labelY - 8} width={labelWidth} height={11} rx={2} className="site-chart-label-bg" />
            <text x={labelX} y={labelY} className="site-chart-zone-label">{zoneLabelText}</text>
          </>
        );
      })()}

      {study.events.map((event) => {
        const eventX = x(Date.parse(`${event.date}T00:00:00Z`));
        const eventY = y(event.price);
        const below = event.placement === "below";
        const labelY = below ? eventY + 12 : eventY - 15;
        const labelW = Math.max(event.code.length * 5.4 + 8, 20);
        const labelX = Math.min(Math.max(eventX - labelW / 2, 2), width - labelW - 2);
        return (
          <g key={`${event.code}-${event.date}`}>
            <line x1={eventX} x2={eventX} y1={eventY} y2={labelY} className="site-chart-event-line" />
            <circle cx={eventX} cy={eventY} r={2.2} className="site-chart-event-dot" style={{ fill: eventColor(event.code) }} />
            <rect x={labelX} y={labelY - 7} width={labelW} height={13} rx={3} style={{ fill: eventColor(event.code) }} />
            <text x={labelX + labelW / 2} y={labelY + 2.5} textAnchor="middle" className="site-chart-event-label">
              {event.code}
            </text>
          </g>
        );
      })}

      <text x={pad.left} y={height - 6} className="site-chart-date">
        {formatDate(bars[0].timestamp)}
      </text>
      <text x={width - pad.right} y={height - 6} textAnchor="end" className="site-chart-date">
        {formatDate(bars[bars.length - 1].timestamp)}
      </text>
      <text x={width - pad.right + 4} y={pad.top + 4} className="site-chart-date">
        {formatPrice(max)}
      </text>
      <text x={width - pad.right + 4} y={height - pad.bottom} className="site-chart-date">
        {formatPrice(min)}
      </text>

      <g className="site-chart-pencil" aria-hidden="true">
        <g className="site-chart-pencil-body">
          <path d="M 0 0 L -11 0 L -17 2.5 L -11 5 L 0 5 Z" className="site-chart-pencil-fill" />
          <path d="M 0 0 L 3 2.5 L 0 5 Z" className="site-chart-pencil-tip" />
          <path d="M -13 0 L -12 5" className="site-chart-pencil-band" />
        </g>
        <animateMotion dur="10s" repeatCount="indefinite" path={pencilPath} rotate="0" />
      </g>
    </svg>
  );
}
