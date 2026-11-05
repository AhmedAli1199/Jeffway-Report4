import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";
import { ToastProvider } from "./lib/toast";

// Apply the saved theme before first paint to avoid a flash
try {
  const pref = JSON.parse(localStorage.getItem("pl.theme") ?? '"system"');
  if (pref === "light" || pref === "dark") document.documentElement.setAttribute("data-theme", pref);
} catch {
  /* ignore */
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
