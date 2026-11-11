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
 * The one real chart on the landing page.
 *
 * Moutai's spring and the November SOS are far apart on the timeline, so the
 * labels stay readable at hero size. Only two events are marked; the glossary
 * below carries the full vocabulary.
 */
export const landingCase: CaseStudy = {
  symbol: "600519.SH",
  chartFrom: "2026-05-01",
  chartTo: "2026-11-10",
  zone: { from: "2026-06-15", to: "2026-07-13", support: 1170.28, resistance: 1234.78, phase: "B" },
  events: [
    { code: "Spring", date: "2026-06-28", price: 1151.01, placement: "above" },
    { code: "SOS", date: "2026-11-02", price: 1480, placement: "below" },
  ],
  supports: [1359.97],
  resistances: [1480.6],
};
