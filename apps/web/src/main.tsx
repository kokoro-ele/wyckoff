/// <reference types="vite/client" />
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthGate } from "./components/AuthGate.js";
import { App } from "./App.js";
import "./index.css";
import { ThemeProvider } from "./theme.js";
import { EffectsProvider } from "./components/CanvasSurface.js";

const container = document.getElementById("root");
if (!container) throw new Error("找不到 #root 挂载点");

createRoot(container).render(
  <StrictMode>
    <ThemeProvider><EffectsProvider><AuthGate><App /></AuthGate></EffectsProvider></ThemeProvider>
  </StrictMode>,
);
