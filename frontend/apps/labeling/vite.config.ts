import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import fs from "node:fs";
import path from "path";

const loadRootDevEnv = () => {
  const envFilePath = path.resolve(__dirname, "../../../.dev.env");
  if (!fs.existsSync(envFilePath)) {
    return {};
  }

  const parsed = Object.fromEntries(
    fs
      .readFileSync(envFilePath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separatorIndex = line.indexOf("=");
        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();
        return [key, value];
      }),
  );

  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [
      key,
      value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, variableName) => parsed[variableName] ?? ""),
    ]),
  );
};

export default defineConfig(({ mode }) => {
  const rootDevEnv = loadRootDevEnv();
  const env = {
    ...rootDevEnv,
    ...loadEnv(mode, process.cwd(), ""),
  };
  const backendUrl = env.VITE_BACKEND_URL || env.BACKEND_URL || "http://127.0.0.1:3000";
  const base = env.VITE_APP_BASE || "/labeling-app/";
  const googleClientId =
    env.VITE_GOOGLE_CLIENT_ID || env.LABELING_GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID || "";

  return {
    base,
    plugins: [
      react(),
      {
        name: "labeling-base-slash-redirect",
        configureServer(server) {
          const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
          server.middlewares.use((req, res, next) => {
            if (!req.url || !normalizedBase || normalizedBase === "/") {
              next();
              return;
            }

            const [pathname, suffix = ""] = req.url.split("?");

            // Vite serves `public/` files from the root in dev. Rewrite requests
            // under the app base so `/labeling-app/manifest.json` resolves.
            if (
              pathname.startsWith(`${normalizedBase}/`) &&
              !pathname.startsWith(`${normalizedBase}/@`) &&
              !pathname.startsWith(`${normalizedBase}/src/`) &&
              !pathname.startsWith(`${normalizedBase}/node_modules/`) &&
              /\.[a-zA-Z0-9]+$/.test(pathname)
            ) {
              req.url = `${pathname.slice(normalizedBase.length)}${suffix ? `?${suffix}` : ""}`;
              next();
              return;
            }

            if (pathname === normalizedBase) {
              res.statusCode = 302;
              res.setHeader("Location", `${normalizedBase}/${suffix ? `?${suffix}` : ""}`);
              res.end();
              return;
            }

            next();
          });
        },
      },
    ],
    define: {
      "import.meta.env.VITE_GOOGLE_CLIENT_ID": JSON.stringify(googleClientId),
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    server: {
      host: "127.0.0.1",
      port: 5174,
      strictPort: true,
      proxy: {
        "/api": {
          target: backendUrl,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
