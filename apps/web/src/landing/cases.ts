export interface CaseEvent {
  code: string;
  date: string;
  price: number;
  placement: "above" | "below";
}

export interface CaseStudy {
  key: "aapl" | "maotai";
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
 * Fixed historical windows used by the landing page.
 *
 * These are real TickFlow daily windows, not synthetic charts. The event labels
 * are the workbench's reading of those windows and are explicitly illustrative.
 */
export const landingCases: CaseStudy[] = [
  {
    key: "aapl",
    symbol: "AAPL.US",
    chartFrom: "2026-06-15",
    chartTo: "2026-11-10",
    zone: { from: "2026-07-31", to: "2026-08-31", support: 299.74, resistance: 322.37, phase: "B" },
    events: [
      { code: "Shakeout", date: "2026-07-31", price: 299.74, placement: "below" },
      { code: "LPS", date: "2026-11-03", price: 325.33, placement: "below" },
      { code: "SOS", date: "2026-11-04", price: 349.51, placement: "below" },
      { code: "UT", date: "2026-11-05", price: 355.38, placement: "above" },
    ],
    supports: [338.3, 325.33],
    resistances: [351.73, 355.38],
  },
  {
    key: "maotai",
    symbol: "600519.SH",
    chartFrom: "2026-05-01",
    chartTo: "2026-11-10",
    zone: { from: "2026-06-15", to: "2026-07-13", support: 1170.28, resistance: 1234.78, phase: "B" },
    events: [
      { code: "Spring", date: "2026-06-28", price: 1151.01, placement: "below" },
      { code: "SOS", date: "2026-11-02", price: 1480, placement: "below" },
      { code: "UT", date: "2026-11-03", price: 1480.6, placement: "above" },
    ],
    supports: [1359.97],
    resistances: [1480.6],
  },
];
