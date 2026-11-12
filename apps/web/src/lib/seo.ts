import { useEffect } from "react";

export const SEO_ORIGIN = "https://easywyckoff.online";
export const SEO_IMAGE = `${SEO_ORIGIN}/og.png`;

export interface SeoInput {
  title: string;
  description: string;
  path: string;
  lang: "zh" | "en";
  image?: string;
  type?: "website" | "article";
  noindex?: boolean;
  alternates?: { hreflang: string; href: string }[];
  jsonLd?: Record<string, unknown>[];
}

function meta(selector: string, attrs: Record<string, string>): HTMLMetaElement {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement("meta");
    document.head.appendChild(element);
  }
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
}

function link(selector: string, attrs: Record<string, string>): HTMLLinkElement {
  let element = document.head.querySelector<HTMLLinkElement>(selector);
  if (!element) {
    element = document.createElement("link");
    document.head.appendChild(element);
  }
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
}

function setJsonLd(items: Record<string, unknown>[] | undefined): void {
  document.head.querySelectorAll('script[data-seo-jsonld="1"]').forEach((node) => node.remove());
  for (const item of items ?? []) {
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.dataset.seoJsonld = "1";
    script.textContent = JSON.stringify(item);
    document.head.appendChild(script);
  }
}

/** Route-aware metadata for the SPA. Google renders it after hydration. */
export function useSeo(input: SeoInput): void {
  const inputKey = JSON.stringify(input);
  useEffect(() => {
    const url = `${SEO_ORIGIN}${input.path}`;
    document.documentElement.lang = input.lang === "zh" ? "zh-CN" : "en";
    document.title = input.title;
    meta('meta[name="description"]', { name: "description", content: input.description });
    meta('meta[name="robots"]', {
      name: "robots",
      content: input.noindex ? "noindex,nofollow" : "index,follow,max-image-preview:large",
    });
    meta('meta[name="theme-color"]', { name: "theme-color", content: "#f4eee6" });
    meta('meta[property="og:type"]', { property: "og:type", content: input.type ?? "website" });
    meta('meta[property="og:site_name"]', { property: "og:site_name", content: "EasyWyckoff" });
    meta('meta[property="og:title"]', { property: "og:title", content: input.title });
    meta('meta[property="og:description"]', { property: "og:description", content: input.description });
    meta('meta[property="og:url"]', { property: "og:url", content: url });
    meta('meta[property="og:image"]', { property: "og:image", content: input.image ?? SEO_IMAGE });
    meta('meta[property="og:image:width"]', { property: "og:image:width", content: "1200" });
    meta('meta[property="og:image:height"]', { property: "og:image:height", content: "630" });
    meta('meta[property="og:locale"]', { property: "og:locale", content: input.lang === "zh" ? "zh_CN" : "en_US" });
    meta('meta[name="twitter:card"]', { name: "twitter:card", content: "summary_large_image" });
    meta('meta[name="twitter:title"]', { name: "twitter:title", content: input.title });
    meta('meta[name="twitter:description"]', { name: "twitter:description", content: input.description });
    meta('meta[name="twitter:image"]', { name: "twitter:image", content: input.image ?? SEO_IMAGE });
    link('link[rel="canonical"]', { rel: "canonical", href: url });
    document.head.querySelectorAll('link[rel="alternate"][hreflang]').forEach((node) => node.remove());
    for (const alternate of input.alternates ?? []) {
      const element = document.createElement("link");
      element.rel = "alternate";
      element.hreflang = alternate.hreflang;
      element.href = alternate.href;
      element.dataset.seoHreflang = "1";
      document.head.appendChild(element);
    }
    setJsonLd(input.jsonLd);
  }, [inputKey]);
}
