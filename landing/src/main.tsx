import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./index.css";
import { TransitionProvider } from "./transition";
import Landing from "./pages/Landing";
import { preloadAnalytics } from "./track";

const EarlyAccess = lazy(() => import("./pages/EarlyAccess"));

function loadAnalyticsAfterPaint() {
  const load = () => {
    preloadAnalytics();
  };
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(load);
    return;
  }
  globalThis.setTimeout(load, 1200);
}

loadAnalyticsAfterPaint();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <TransitionProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route
            path="/early-access"
            element={
              <Suspense fallback={null}>
                <EarlyAccess />
              </Suspense>
            }
          />
        </Routes>
      </TransitionProvider>
    </BrowserRouter>
  </StrictMode>
);
