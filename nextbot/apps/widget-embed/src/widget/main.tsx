import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WidgetApp } from "./WidgetApp.js";

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <StrictMode>
      <WidgetApp />
    </StrictMode>,
  );
}
