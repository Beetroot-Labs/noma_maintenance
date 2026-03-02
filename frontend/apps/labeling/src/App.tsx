import {
  Box,
  CssBaseline,
  ThemeProvider,
} from "@mui/material";
import { AuthProvider } from "@noma/shared";
import { LabelingHome } from "./LabelingHome";
import { theme } from "./theme";

export default function App() {
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
          <LabelingHome googleClientId={import.meta.env.VITE_GOOGLE_CLIENT_ID} />
        </AuthProvider>
      </Box>
    </ThemeProvider>
  );
}
