/**
 * English display names for US instruments.
 *
 * TickFlow only supplies Chinese names. The Nasdaq trader symbol directory is
 * free, public and covers both listed stocks and ETFs, so we cache it in memory
 * per server instance. Search awaits one load; later lookups are synchronous.
 */
const SOURCES = [
  "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt",
  "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt",
];
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

let names = new Map<string, string>();
let loadedAt = 0;
// A few high-traffic symbols should never show only a ticker while the Nasdaq
// directory is still warming up.
const FALLBACK_NAMES: Record<string, string> = {
  NVDA: "NVIDIA",
  AAPL: "Apple",
  MSFT: "Microsoft",
  AMZN: "Amazon",
  GOOGL: "Alphabet",
  META: "Meta",
  TSLA: "Tesla",
  AMD: "AMD",
  NFLX: "Netflix",
  AVGO: "Broadcom",
};
let loading: Promise<void> | null = null;

function cleanName(value: string): string {
  return value
    .replace(/\s+-\s+Common Stock$/i, "")
    .replace(/\s+-\s+American Depositary Shares.*$/i, "")
    .replace(/\s+-\s+Class [A-Z].*$/i, "")
    .replace(/\s+Common Stock$/i, "")
    .trim();
}

function parse(text: string): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("File Creation Time")) continue;
    const parts = line.split("|");
    const symbol = parts[0]?.trim().toUpperCase();
    const name = parts[1]?.trim();
    if (!symbol || !name || symbol === "SYMBOL" || symbol === "ACT SYMBOL") continue;
    rows.push([symbol, cleanName(name)]);
  }
  return rows;
}

export async function ensureEnglishNames(force = false): Promise<void> {
  if (!force && names.size > 0 && Date.now() - loadedAt < TTL_MS) return;
  if (loading) return loading;
  loading = (async () => {
    const next = new Map<string, string>();
    await Promise.all(
      SOURCES.map(async (url) => {
        try {
          const response = await fetch(url, {
            headers: { "User-Agent": "EasyWyckoff/1.0" },
            signal: AbortSignal.timeout(20_000),
          });
          if (!response.ok) return;
          for (const [symbol, name] of parse(await response.text())) {
            if (!next.has(symbol)) next.set(symbol, name);
          }
        } catch {
          /* best effort; code fallback remains available */
        }
      }),
    );
    if (next.size > 0) {
      names = next;
      loadedAt = Date.now();
    }
  })().finally(() => {
    loading = null;
  });
  return loading;
}

export function getEnglishName(code: string): string | null {
  const key = code.trim().toUpperCase();
  return names.get(key) ?? FALLBACK_NAMES[key] ?? null;
}
