import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((registration) => {
        const promptUpdate = (reg: ServiceWorkerRegistration) => {
          if (!reg.waiting) return;
          const shouldUpdate = window.confirm(
            "Új verzió érhető el. Frissíti most az alkalmazást?",
          );
          if (shouldUpdate) {
            reg.waiting.postMessage({ type: "SKIP_WAITING" });
          }
        };

        if (registration.waiting) {
          promptUpdate(registration);
        }

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed") {
              promptUpdate(registration);
            }
          });
        });

        let refreshing = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (refreshing) return;
          refreshing = true;
          window.location.reload();
        });
      })
      .catch(() => {
        // Ignore registration errors in demo mode.
      });
  });
}
