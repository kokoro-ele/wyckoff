import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { useI18n } from "./i18n.js";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
const STORAGE_KEY = "wyckoff.theme";
const ThemeContext = createContext<{ theme: ResolvedTheme; preference: ThemePreference; setPreference: (value: ThemePreference) => void }>({ theme: "light", preference: "system", setPreference: () => {} });

function savedPreference(): ThemePreference {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("theme");
    if (fromUrl === "light" || fromUrl === "dark") return fromUrl;
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch { return "system"; }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(savedPreference);
  const [systemDark, setSystemDark] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches);
  const theme = preference === "system" ? systemDark ? "dark" : "light" : preference;
  useLayoutEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    const sync = (event: StorageEvent) => { if (event.key === STORAGE_KEY) setPreference(savedPreference()); };
    window.addEventListener("storage", sync);
    return () => { media.removeEventListener("change", update); window.removeEventListener("storage", sync); };
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try { localStorage.setItem(STORAGE_KEY, preference); } catch { /* Private browser storage can be unavailable. */ }
  }, [theme, preference]);
  return <ThemeContext.Provider value={{ theme, preference, setPreference }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

export function ThemeSelector() {
  const { preference, setPreference } = useTheme();
  const { t } = useI18n();
  return <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-dim">
    <span className="sr-only">{t("settings.theme")}</span>
    <select aria-label={t("settings.theme")} value={preference} onChange={(event) => setPreference(event.target.value as ThemePreference)} className="hand-input px-2 py-1.5">
      <option value="system">{t("theme.system")}</option>
      <option value="light">{t("theme.light")}</option>
      <option value="dark">{t("theme.dark")}</option>
    </select>
  </label>;
}
