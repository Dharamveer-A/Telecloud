import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Automatically reload if a dynamic import fails due to new deployment
window.addEventListener("vite:preloadError", (event) => {
  console.warn("Vite asset preload failed (deployment updated), reloading fresh version...", event);
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

