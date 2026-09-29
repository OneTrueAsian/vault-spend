import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { StartupGate } from "./StartupGate";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <StartupGate>
      <App />
    </StartupGate>
  </React.StrictMode>,
);
