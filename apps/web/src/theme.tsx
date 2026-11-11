import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
const STORAGE_KEY = "wyckoff.theme";
const ThemeContext = createContext<{ theme: ResolvedTheme; preference: ThemePreference; setPreference: (value: ThemePreference) => void }>({ theme: "light", preference: "system", setPreference: () => {} });

function savedPreference(): ThemePreference {
  try {
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
  return <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-dim">
    <span className="sr-only">界面主题</span>
    <select aria-label="界面主题" value={preference} onChange={(event) => setPreference(event.target.value as ThemePreference)} className="rounded-lg border border-line bg-panel px-2 py-1.5 text-ink">
      <option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option>
    </select>
  </label>;
}
