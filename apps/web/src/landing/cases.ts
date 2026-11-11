export interface CaseEvent {
  code: string;
  date: string;
  price: number;
  placement: "above" | "below";
}

export interface CaseStudy {
  symbol: string;
  chartFrom: string;
  chartTo: string;
  zone: {
    from: string;
    to: string;
    support: number;
    resistance: number;
    phase: "A" | "B" | "C" | "D" | "E";
  };
  events: CaseEvent[];
  supports: number[];
  resistances: number[];
}

/**
 * NVDA over the last year.
 *
 * Five events are spread across the year so no two labels collide:
 * UT (Nov 2025) → SOS (Apr 2026) → Spring (Jun) → UT (Sep) → SOW (Oct).
 */
export const landingCase: CaseStudy = {
  symbol: "NVDA.US",
  chartFrom: "2025-11-11",
  chartTo: "2026-11-10",
  zone: { from: "2026-08-07", to: "2026-09-30", support: 208.93, resistance: 230.21, phase: "B" },
  events: [
    { code: "UT", date: "2025-11-20", price: 195.53, placement: "above" },
    { code: "SOS", date: "2026-04-27", price: 216.33, placement: "above" },
    { code: "Spring", date: "2026-06-29", price: 189.59, placement: "below" },
    { code: "UT", date: "2026-09-04", price: 234.5, placement: "above" },
    { code: "SOW", date: "2026-10-30", price: 204.64, placement: "below" },
  ],
  supports: [208.93],
  resistances: [230.21],
};
