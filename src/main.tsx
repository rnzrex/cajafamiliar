import React from "react";
import ReactDOM from "react-dom/client";
import { AuthGate } from "./components/AuthGate";
import { PwaUpdatePrompt } from "./components/PwaUpdatePrompt";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthGate />
    <PwaUpdatePrompt />
  </React.StrictMode>
);
