import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { LegalNoticeGate } from "./LegalNoticeGate";
import { StartupGate } from "./StartupGate";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <LegalNoticeGate>
      <StartupGate>
        <App />
      </StartupGate>
    </LegalNoticeGate>
  </React.StrictMode>,
);
