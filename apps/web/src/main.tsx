/// <reference types="vite/client" />
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./index.css";
import { I18nProvider } from "./i18n.js";
import { ThemeProvider } from "./theme.js";
import { AuthProvider } from "./auth/AuthProvider.js";
import { LandingPage } from "./landing/LandingPage.js";
import { AdminPage } from "./AdminPage.js";
import { LegalPage } from "./LegalPage.js";
import { LearnPage } from "./LearnPage.js";

const container = document.getElementById("root");
if (!container) throw new Error("找不到 #root 挂载点");

// OAuth cookies are host-scoped. If the ad/landing link used a preview or www
// host, the callback would be written to the canonical host while the user is
// returned to the alias without a session. Normalize before booting the app.
try {
  const host = window.location.hostname;
  const canonical =
    host === "www.easywyckoff.online" || host === "wyckoff-one.vercel.app"
      ? "https://easywyckoff.online"
      : /^wyckoff-staging-.*\.vercel\.app$/.test(host)
        ? "https://staging.easywyckoff.online"
        : null;
  if (canonical) {
    window.location.replace(`${canonical}${window.location.pathname}${window.location.search}${window.location.hash}`);
  }
} catch {
  /* ignore non-browser hosts */
}

// Some mobile OAuth returns land on `/` even when Better Auth was given an
// `/app` callback URL. Keep a small marker and recover the intended route.
try {
  const postAuth = localStorage.getItem("wyckoff:postAuth");
  if (postAuth) {
    if (window.location.pathname === "/") {
      localStorage.removeItem("wyckoff:postAuth");
      window.location.replace(postAuth);
    } else if (window.location.pathname === "/app" || window.location.pathname.startsWith("/app/")) {
      localStorage.removeItem("wyckoff:postAuth");
    }
  }
} catch {
  /* storage can be unavailable in private webviews */
}

// Better Auth redirects failed OAuth flows to /error. This SPA would otherwise
// render the marketing page there, which looks like a successful callback with
// no login state. Send the user back to the auth dialog instead.
if (window.location.pathname === "/error") {
  window.location.replace("/app?auth=1");
}

const isWorkbench = window.location.pathname === "/app" || window.location.pathname.startsWith("/app/");
const isAdmin = window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/");
const legalKind = window.location.pathname === "/privacy" ? "privacy" : window.location.pathname === "/terms" ? "terms" : window.location.pathname === "/refund" ? "refund" : window.location.pathname === "/contact" ? "contact" : null;
const learnLang = window.location.pathname === "/learn/zh" ? "zh" : window.location.pathname === "/learn/en" ? "en" : null;
createRoot(container).render(
  <StrictMode>
    <I18nProvider>
      <ThemeProvider>
        {isWorkbench ? (
          <AuthProvider>
            <App />
          </AuthProvider>
        ) : isAdmin ? (
          <AuthProvider>
            <AdminPage />
          </AuthProvider>
        ) : legalKind ? (
          <LegalPage kind={legalKind} />
        ) : learnLang ? (
          <LearnPage pathLang={learnLang} />
        ) : (
          <LandingPage />
        )}
      </ThemeProvider>
    </I18nProvider>
  </StrictMode>,
);
