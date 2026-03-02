import {
  AppBar,
  Box,
  BottomNavigation,
  BottomNavigationAction,
  Button,
  Card,
  CardContent,
  Chip,
  CssBaseline,
  Divider,
  Paper,
  Stack,
  ThemeProvider,
  Typography,
} from "@mui/material";
import { Camera, LayoutGrid, ScanLine, Tag } from "lucide-react";
import { AuthProvider, productNames, useAuth } from "@noma/shared";
import LoginPage from "./LoginPage";
import { theme } from "./theme";

const features = [
  "Belépés és jogosultságkezelés",
  "Vonalkód beolvasás vagy kézi megadás",
  "Gyors eszköz-azonosítás",
  "Új barcode hozzárendelés",
  "Eszközfotó feltöltés",
];

function LabelingHome() {
  const { user, clearUser, isHydrated } = useAuth();
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  if (!isHydrated) {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", px: 2 }}>
        <Typography variant="h2">Betöltés...</Typography>
      </Box>
    );
  }

  if (!user) {
    return <LoginPage googleClientId={googleClientId} />;
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <AppBar
        position="sticky"
        elevation={0}
        sx={{
          background: "rgba(232, 238, 241, 0.88)",
          color: "text.primary",
          borderBottom: "1px solid rgba(20, 35, 52, 0.08)",
          backdropFilter: "blur(12px)",
        }}
      >
        <Box
          sx={{
            px: 2,
            pt: "max(10px, env(safe-area-inset-top))",
            pb: 1.5,
          }}
        >
          <Stack direction="row" spacing={2} justifyContent="space-between" alignItems="center">
            <Box>
              <Typography
                variant="overline"
                sx={{ letterSpacing: "0.16em", color: "secondary.main", fontWeight: 700 }}
              >
                NoMa Karbantartás
              </Typography>
              <Typography variant="h2" sx={{ mb: 0.25 }}>
                Címkéző
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {user.name}
              </Typography>
            </Box>
            <Box>
              <Button variant="text" color="primary" onClick={() => void clearUser()}>
                Kijelentkezés
              </Button>
            </Box>
          </Stack>
        </Box>
      </AppBar>

      <Box
        sx={{
          flex: 1,
          width: "min(920px, 100%)",
          mx: "auto",
          px: 2,
          py: 2,
          pb: "calc(96px + env(safe-area-inset-bottom))",
        }}
      >
        <Stack spacing={2}>
          <Paper
            sx={{
              borderRadius: "5px",
              overflow: "hidden",
              border: "1px solid rgba(20, 35, 52, 0.08)",
              background: "rgba(255,255,255,0.86)",
            }}
          >
            <CardContent sx={{ p: 3 }}>
              <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: "wrap" }}>
                <Chip label="Mobil fókusz" color="primary" variant="outlined" />
                <Chip label="Google bejelentkezés" color="secondary" />
                <Chip label="Belső használat" variant="outlined" />
              </Stack>
              <Typography variant="h2" sx={{ mb: 1 }}>
                Mai állapot
              </Typography>
              <Typography color="text.secondary">
                A következő képernyők a vonalkódolvasásra, az eszközkeresésre és az új címke
                hozzárendelésére lesznek optimalizálva.
              </Typography>
            </CardContent>
          </Paper>

          <Paper
            sx={{
              borderRadius: "5px",
              overflow: "hidden",
              border: "1px solid rgba(20, 35, 52, 0.08)",
              background: "rgba(255,255,255,0.78)",
            }}
          >
            <CardContent sx={{ p: 0 }}>
              <Box sx={{ px: 3, py: 2.25 }}>
                <Typography variant="h2">Következő funkciók</Typography>
              </Box>
              <Divider />
              <Stack>
                {features.map((feature, index) => (
                  <Box
                    key={feature}
                    sx={{
                      px: 3,
                      py: 2,
                      borderTop: index === 0 ? "none" : "1px solid rgba(20, 35, 52, 0.06)",
                    }}
                  >
                    <Typography>{feature}</Typography>
                  </Box>
                ))}
              </Stack>
            </CardContent>
          </Paper>
        </Stack>
      </Box>

      <Paper
        elevation={12}
        sx={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          borderTop: "1px solid rgba(20, 35, 52, 0.08)",
          borderRadius: 0,
          background: "rgba(255,255,255,0.92)",
          backdropFilter: "blur(12px)",
          pb: "env(safe-area-inset-bottom)",
        }}
      >
        <BottomNavigation showLabels value={0}>
          <BottomNavigationAction label="Áttekintés" icon={<LayoutGrid size={18} />} />
          <BottomNavigationAction label="Olvasás" icon={<ScanLine size={18} />} />
          <BottomNavigationAction label="Címkék" icon={<Tag size={18} />} />
          <BottomNavigationAction label="Fotó" icon={<Camera size={18} />} />
        </BottomNavigation>
      </Paper>
    </Box>
  );
}

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          minHeight: "100vh",
          background:
            "radial-gradient(circle at top left, rgba(219, 113, 38, 0.16), transparent 24%), radial-gradient(circle at bottom right, rgba(33, 74, 109, 0.12), transparent 32%), linear-gradient(180deg, #eff3f5 0%, #e3eaee 100%)",
        }}
      >
        <AuthProvider defaultRole="technician">
          <LabelingHome />
        </AuthProvider>
      </Box>
    </ThemeProvider>
  );
}
