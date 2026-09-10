import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@xyflow/react/dist/style.css";
import "./styles.css";
import { App } from "./app/App";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Studio root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
