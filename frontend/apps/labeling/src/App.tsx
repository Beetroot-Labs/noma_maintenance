import {
  Box,
  CssBaseline,
  ThemeProvider,
} from "@mui/material";
import { AuthProvider } from "@noma/shared";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { DeviceDetailsPage } from "./DeviceDetailsPage";
import { LabelingHome } from "./LabelingHome";
import { theme } from "./theme";

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
