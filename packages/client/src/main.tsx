import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { ThemeProvider } from "./components/ThemeProvider";
import { TooltipProvider } from "./components/ui/tooltip";
import {
  installAutomationBridge,
  installAutomationRuntimeBridgeListener,
} from "./automation/bridge";

installAutomationBridge();
void installAutomationRuntimeBridgeListener().catch((error) => {
  console.error("failed to install automation runtime bridge listener", error);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
