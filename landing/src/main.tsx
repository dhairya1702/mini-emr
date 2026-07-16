import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./index.css";
import { TransitionProvider } from "./transition";
import Landing from "./pages/Landing";
import EarlyAccess from "./pages/EarlyAccess";
import "./analytics";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <TransitionProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/early-access" element={<EarlyAccess />} />
        </Routes>
      </TransitionProvider>
    </BrowserRouter>
  </StrictMode>
);
