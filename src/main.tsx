import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { LegalNoticeGate } from "./features/help/LegalNoticeGate";
import { StartupGate } from "./app/StartupGate";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <LegalNoticeGate>
      <StartupGate>
        <App />
      </StartupGate>
    </LegalNoticeGate>
  </React.StrictMode>,
);
