import type { TermCode } from "./copy.js";

const paths: Record<TermCode, string> = {
  Spring: "M8 40 L20 33 L32 43 L44 34 L56 43 L68 36 L78 48 L84 64 L92 44 L102 34 L118 27 L138 20 L168 13",
  Shakeout: "M8 40 L20 33 L32 43 L44 34 L56 43 L68 36 L78 48 L84 66 L92 40 L104 32 L120 25 L140 18 L168 11",
  SOS: "M8 40 L20 33 L32 43 L44 34 L56 43 L68 36 L78 32 L90 40 L100 18 L112 12 L130 8 L150 5 L168 4",
  LPS: "M8 40 L20 33 L32 43 L44 34 L56 43 L68 36 L78 32 L90 18 L100 8 L108 24 L118 17 L136 11 L168 6",
  UT: "M8 40 L20 33 L32 43 L44 34 L56 43 L68 36 L78 32 L90 10 L98 30 L108 36 L124 39 L150 42 L168 44",
  SOW: "M8 40 L20 33 L32 43 L44 34 L56 43 L68 36 L78 50 L88 66 L102 60 L118 68 L140 70 L168 72",
};

const dots: Record<TermCode, [number, number]> = {
  Spring: [84, 64],
  Shakeout: [84, 66],
  SOS: [100, 18],
  LPS: [108, 24],
  UT: [90, 10],
  SOW: [88, 66],
};

const bullish: TermCode[] = ["Spring", "Shakeout", "SOS", "LPS"];

export function TermDiagram({ code }: { code: TermCode }) {
  const [dotX, dotY] = dots[code];
  return (
    <svg className="site-term-diagram" viewBox="0 0 180 76" role="img" aria-hidden="true">
      <line x1="26" x2="130" y1="22" y2="22" className="site-term-level" />
      <line x1="26" x2="130" y1="54" y2="54" className="site-term-level" />
      <rect x="30" y="22" width="80" height="32" className="site-term-range" />
      <path d={paths[code]} className="site-term-line" />
      <circle
        cx={dotX}
        cy={dotY}
        r="3.2"
        className={bullish.includes(code) ? "site-term-dot site-term-dot-bull" : "site-term-dot site-term-dot-bear"}
      />
    </svg>
  );
}
