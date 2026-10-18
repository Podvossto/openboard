import { StrictMode } from "react";
if (import.meta.env.MODE === "mock") await import("./dev/tauri-mock");
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "@xterm/xterm/css/xterm.css";
import "./styles/tokens.css";
import "./styles/app.css";
import { App } from "./app/App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
