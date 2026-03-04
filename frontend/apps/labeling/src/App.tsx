import {
  Box,
  CssBaseline,
  ThemeProvider,
} from "@mui/material";
import { AuthProvider, useAuth } from "@noma/shared";
import { useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { DeviceDetailsPage } from "./DeviceDetailsPage";
import { LabelingHome } from "./LabelingHome";
import { syncPendingBarcodeAssignments } from "./lib/offlineCache";
import { theme } from "./theme";

function BarcodeSyncManager() {
  const { user, isHydrated } = useAuth();

  useEffect(() => {
    if (!isHydrated || !user) {
      return;
    }

    const runSync = () => {
      void syncPendingBarcodeAssignments();
    };

    runSync();
    const intervalId = window.setInterval(runSync, 60_000);
    window.addEventListener("online", runSync);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("online", runSync);
    };
  }, [isHydrated, user]);

  return null;
}

export default function App() {
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const basename = import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          minHeight: "100vh",
          background: "background.default",
        }}
      >
        <AuthProvider defaultRole="technician">
          <BarcodeSyncManager />
          <BrowserRouter basename={basename}>
            <Routes>
              <Route path="/" element={<LabelingHome googleClientId={googleClientId} />} />
              <Route
                path="/devices/:id"
                element={<DeviceDetailsPage googleClientId={googleClientId} />}
              />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </Box>
    </ThemeProvider>
  );
}
