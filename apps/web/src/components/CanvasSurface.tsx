import { Component, createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { Grid } from "./canvasui/Grid.js";

const EffectsContext = createContext({ enabled: true, toggle: () => {} });
export function EffectsProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(() => { try { return localStorage.getItem("wyckoff.effects") !== "off"; } catch { return true; } });
  const toggle = () => setEnabled(value => { try { localStorage.setItem("wyckoff.effects", value ? "off" : "on"); } catch { /* Optional preference storage. */ } return !value; });
  return <EffectsContext.Provider value={{ enabled, toggle }}>{children}</EffectsContext.Provider>;
}
export function EffectsToggle() {
  const { enabled, toggle } = useContext(EffectsContext);
  return <button className="canvas-action" aria-label="纸面动效" aria-pressed={enabled} onClick={toggle} title="纸面动效：开启或关闭"><Sparkles size={16} /><span className="hidden sm:inline">动效</span></button>;
}
class EffectBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
/** Effects are scoped to decorative surfaces; live prices and form inputs stay native. */
export function CanvasSurface({ children, className = "", compact = false }: { children: ReactNode; className?: string; compact?: boolean }) {
  const { enabled } = useContext(EffectsContext);
  const [reduced, setReduced] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const fallback = <div className={`canvas-ui-surface ${className}`}>{children}</div>;
  if (!enabled || reduced) return fallback;
  return <EffectBoundary fallback={fallback}><Grid className={`canvas-ui-surface ${className}`} tileSize={compact ? 24 : 56} amplitude={0.6} maxLift={0.25} liftHeight={12} tilt={0.15} tint={[0.85, 0.55, 0.68]} tintStrength={0.18} idleRipples={0} cornerRadius={3}>{children}</Grid></EffectBoundary>;
}
export function MarketArtwork() {
  return <svg className="canvas-market-art" viewBox="0 0 640 150" preserveAspectRatio="none" aria-hidden="true">
    <defs><pattern id="market-grid" width="32" height="30" patternUnits="userSpaceOnUse"><path d="M 32 0 L 0 0 0 30" fill="none" stroke="currentColor" strokeOpacity=".09" /></pattern></defs>
    <rect width="640" height="150" fill="url(#market-grid)" />
    <path d="M0 118 L35 111 L65 124 L100 84 L135 97 L170 74 L205 92 L245 55 L285 70 L320 40 L365 59 L405 36 L450 50 L490 23 L535 37 L580 18 L640 28" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>;
}
