import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);

/* Web fonts load AFTER the first render (spec 10.1): a stylesheet in <head>
   would block painting until the font host answered, and on a slow or
   filtered network that is seconds of blank screen. Fallback faces are
   declared in styles.css, so nothing waits on this. */
const fonts = document.createElement("link");
fonts.rel = "stylesheet";
fonts.href = "https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600&family=Atkinson+Hyperlegible:wght@400;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap";
document.head.appendChild(fonts);

/* Register the service worker for offline shell loading (spec 10.6).
   Failure is silent: the app works perfectly well without it. */
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
