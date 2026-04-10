import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import LogRocket from "logrocket";
import App from "./App.tsx";

if (!import.meta.env.DEV) {
  LogRocket.init("xctxm9/noma-maintenance");
}

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
if (basePath && basePath !== "/" && window.location.pathname === basePath) {
  window.location.replace(`${basePath}/${window.location.search}${window.location.hash}`);
} else {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

if (import.meta.env.DEV && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        registration.unregister();
      });
    });
  });
}

if (!import.meta.env.DEV && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: "none" })
      .then((registration) => {
        registration.update().catch(() => {
          // Ignore update check failures.
        });

        const activateUpdate = (reg: ServiceWorkerRegistration) => {
          if (!reg.waiting) return;
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
        };

        if (registration.waiting) {
          activateUpdate(registration);
        }

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed") {
              activateUpdate(registration);
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
        // Ignore registration errors during local development.
      });
  });
}
