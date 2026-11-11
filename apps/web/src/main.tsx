/// <reference types="vite/client" />
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./index.css";
import { I18nProvider } from "./i18n.js";
import { ThemeProvider } from "./theme.js";
import { AuthProvider } from "./auth/AuthProvider.js";
import { LandingPage } from "./landing/LandingPage.js";

const container = document.getElementById("root");
if (!container) throw new Error("找不到 #root 挂载点");

const isWorkbench = window.location.pathname === "/app" || window.location.pathname.startsWith("/app/");
createRoot(container).render(
  <StrictMode>
    <I18nProvider>
      <ThemeProvider>
        {isWorkbench ? (
          <AuthProvider>
            <App />
          </AuthProvider>
        ) : (
          <LandingPage />
        )}
      </ThemeProvider>
    </I18nProvider>
  </StrictMode>,
);
