export interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
}

interface CacheEntry {
  at: number;
  items: NewsItem[];
}

const FEEDS: Record<"zh" | "en", { url: string; source: string }[]> = {
  en: [
    {
      url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114",
      source: "CNBC",
    },
  ],
  zh: [
    {
      url: "https://rss.eastmoney.com/rss_partener.xml",
      source: "东方财富",
    },
  ],
};

const cache = new Map<"zh" | "en", CacheEntry>();
const CACHE_TTL = 10 * 60_000;

function decode(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string): string {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return match ? decode(match[1]) : "";
}

function parseFeed(xml: string, source: string): NewsItem[] {
  const items: NewsItem[] = [];
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = match[1];
    const title = tag(block, "title");
    const url = tag(block, "link");
    if (!title || !/^https?:\/\//i.test(url)) continue;
    items.push({
      title,
      url,
      source,
      publishedAt: tag(block, "pubDate") || null,
    });
    if (items.length >= 12) break;
  }
  return items;
}

async function fetchFeed(url: string, source: string): Promise<NewsItem[]> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "EasyWyckoff/1.0 (+https://easywyckoff.online)",
        Accept: "application/rss+xml, application/xml, text/xml",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return [];
    return parseFeed(await response.text(), source);
  } catch {
    return [];
  }
}

/** Free RSS headlines, cached per process. Full articles stay on the source site. */
export async function getNewsHeadlines(language: "zh" | "en"): Promise<{ items: NewsItem[]; updatedAt: string }> {
  const existing = cache.get(language);
  if (existing && Date.now() - existing.at < CACHE_TTL) {
    return { items: existing.items, updatedAt: new Date(existing.at).toISOString() };
  }
  const items = (await Promise.all(FEEDS[language].map((feed) => fetchFeed(feed.url, feed.source))))
    .flat()
    .filter((item) => item.title.length >= 4);
  const entry = { at: Date.now(), items };
  cache.set(language, entry);
  return { items, updatedAt: new Date(entry.at).toISOString() };
}
