import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Typography,
} from "@mui/material";
import { LockKeyhole, ShieldAlert } from "lucide-react";
import { appColors } from "@/theme";
import { alpha } from "@mui/material/styles";
import { useDemoUser } from "@/context/DemoUserContext";
import { useMaintenance } from "@/context/MaintenanceContext";
import { toast } from "@/lib/toast";
import { GoogleSignInButton } from "@noma/shared";

export default function LoginPage() {
  const navigate = useNavigate();
  const { user, loginWithGoogle, isAuthenticating } = useDemoUser();
  const { resetMaintenance } = useMaintenance();
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  const handleReset = async () => {
    const success = await resetMaintenance();
    if (success) {
      toast.success("A bevitt adatok törölve lettek.");
    }
  };

  useEffect(() => {
    if (user) {
      navigate("/", { replace: true });
    }
  }, [user, navigate]);

  const handleGoogleCredential = async (credential: string) => {
    try {
      await loginWithGoogle(credential);
      toast.success("Sikeres bejelentkezés.");
      navigate("/", { replace: true });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Sikertelen Google bejelentkezés.";
      toast.error(message);
    }
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        bgcolor: appColors.background,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        px: 2,
        py: 4,
      }}
    >
      <Box
        sx={{
          maxWidth: 920,
          mx: "auto",
          width: "100%",
          display: "grid",
          gap: 3,
          gridTemplateColumns: { xs: "1fr", md: "0.9fr 1.1fr" },
          alignItems: "start",
        }}
      >
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.5,
            }}
          >
            <Box
              sx={{
                bgcolor: alpha(appColors.warning, 0.18),
                color: appColors.warning,
                p: 1,
                borderRadius: 2,
                display: "flex",
              }}
            >
              <ShieldAlert size={20} />
            </Box>
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                Google bejelentkezés
              </Typography>
              <Typography variant="body2" color="text.secondary">
                A main app jelenleg csak az adatbázisban szereplő felhasználókat engedi be.
              </Typography>
            </Box>
          </Box>

          <Card sx={{ boxShadow: "0 12px 30px rgba(31, 50, 58, 0.12)" }}>
            <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <Box
                sx={{
                  borderRadius: 2,
                  border: `1px solid ${appColors.border}`,
                  bgcolor: appColors.muted,
                  p: 2,
                }}
              >
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  Figyelem
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Az első sikeres Google belépéskor a rendszer az e-mail cím alapján
                  összekapcsolja a meglévő felhasználót a Google azonosítóval.
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Új felhasználót továbbra sem hoz létre automatikusan.
              </Typography>
            </CardContent>
          </Card>
        </Box>

        <Card sx={{ boxShadow: "0 12px 30px rgba(31, 50, 58, 0.12)" }}>
          <CardContent sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                p: 2,
                borderRadius: 2,
                bgcolor: alpha(appColors.primary, 0.05),
                border: `1px solid ${alpha(appColors.primary, 0.12)}`,
              }}
            >
              <Box
                sx={{
                  width: 40,
                  height: 40,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "50%",
                  bgcolor: alpha(appColors.primary, 0.12),
                  color: appColors.primary,
                }}
              >
                <LockKeyhole size={18} />
              </Box>
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Noma account kapcsolat
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Belépés csak előzetesen létrehozott felhasználóval lehetséges.
                </Typography>
              </Box>
            </Box>

            {!googleClientId ? (
              <Box
                sx={{
                  borderRadius: 2,
                  border: `1px solid ${alpha(appColors.destructive, 0.18)}`,
                  bgcolor: alpha(appColors.destructive, 0.06),
                  p: 2,
                }}
              >
                <Typography variant="body2" sx={{ fontWeight: 600, color: appColors.destructive }}>
                  Hiányzó Google kliens azonosító
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Állítsa be a `VITE_GOOGLE_CLIENT_ID` értéket a frontend környezetben.
                </Typography>
              </Box>
            ) : (
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 2,
                  py: 2,
                }}
              >
                <Box sx={{ minHeight: 44 }}>
                  <GoogleSignInButton
                    clientId={googleClientId}
                    disabled={isAuthenticating}
                    width={Math.min(window.innerWidth - 80, 360)}
                    onCredential={handleGoogleCredential}
                    onLoadError={() => {
                      toast.error("A Google bejelentkezés script nem tölthető be.");
                    }}
                  />
                </Box>
                {isAuthenticating && (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <CircularProgress size={18} />
                    <Typography variant="body2" color="text.secondary">
                      Bejelentkezés folyamatban...
                    </Typography>
                  </Box>
                )}
              </Box>
            )}
          </CardContent>
        </Card>
      </Box>
      <Box sx={{ maxWidth: 920, mx: "auto", width: "100%", mt: 3 }}>
        <Button
          variant="outlined"
          fullWidth
          onClick={handleReset}
          sx={{ borderColor: appColors.border, color: appColors.primary }}
        >
          Bevitt adatok törlése
        </Button>
      </Box>
    </Box>
  );
}
