import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { bootPrefs } from "./lib/prefs";
import "./index.css";

bootPrefs();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
