import { useEffect, useState } from "react";
import { Radio } from "lucide-react";
import * as api from "@/lib/api.js";
import { useI18n } from "@/i18n.js";

export function NewsTicker() {
  const { t, lang } = useI18n();
  const [items, setItems] = useState<api.NewsItem[]>([]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setItems([]);
    setIndex(0);
    void api.fetchNewsHeadlines(lang)
      .then(({ items: next }) => { if (!cancelled) setItems(next); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [lang]);

  useEffect(() => {
    if (items.length < 2) return;
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % items.length), 6000);
    return () => window.clearInterval(timer);
  }, [items.length]);

  if (items.length === 0) return <div className="news-ticker-placeholder" />;
  const item = items[index % items.length];
  return (
    <div className="news-ticker" role="status" aria-live="polite">
      <span className="news-ticker-label"><Radio size={11} />{t("news.label")}</span>
      <a key={`${index}-${item.url}`} className="news-ticker-item" href={item.url} target="_blank" rel="noreferrer" title={item.title}>
        {item.title}
      </a>
      <span className="news-ticker-source">{item.source}</span>
    </div>
  );
}
