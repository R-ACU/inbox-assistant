import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { initMode, initTheme } from "./theme";

// Before the first render, so the page never flashes in the wrong colours.
initTheme();
initMode();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
