import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import fs from "node:fs";
import path from "path";

const loadRootDevEnv = () => {
  const envFilePath = path.resolve(__dirname, "../../../.dev.env");
  if (!fs.existsSync(envFilePath)) {
    return {};
  }

  return Object.fromEntries(
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
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const rootDevEnv = loadRootDevEnv();
  const env = {
    ...rootDevEnv,
    ...loadEnv(mode, process.cwd(), ""),
  };
  const backendUrl = env.VITE_BACKEND_URL || env.BACKEND_URL || "http://127.0.0.1:3000";
  const base = env.VITE_APP_BASE || "/";
  const googleClientId =
    env.VITE_GOOGLE_CLIENT_ID || env.MAIN_GOOGLE_CLIENT_ID || "";

  return {
    base,
    plugins: [react()],
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
      port: 5173,
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
