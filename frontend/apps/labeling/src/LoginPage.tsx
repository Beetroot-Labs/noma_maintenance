import { useAuth, GoogleSignInButton, productNames } from "@noma/shared";
import {
  Alert,
  Box,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";

type LoginPageProps = {
  googleClientId: string;
};

export default function LoginPage({ googleClientId }: LoginPageProps) {
  const { isAuthenticating, loginWithGoogle } = useAuth();

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        px: 2,
        pt: "max(24px, env(safe-area-inset-top))",
        pb: "max(20px, env(safe-area-inset-bottom))",
      }}
    >
      <Box sx={{ px: 1, pt: 3 }}>
        <Typography
          variant="overline"
          sx={{ letterSpacing: "0.16em", color: "primary.main", fontWeight: 700 }}
        >
          NoMa Karbantartás
        </Typography>
        <Typography variant="h1" sx={{ mt: 1, mb: 1 }}>
          Címkéző
        </Typography>
        <Typography color="text.secondary">
          Gyors belépés a belső címkézési felületre.
        </Typography>
      </Box>

      <Box sx={{ display: "grid", placeItems: "center", flex: 1, py: 3 }}>
      <Card
        sx={{
          width: "min(460px, 100%)",
          borderRadius: "5px",
          border: "1px solid",
          borderColor: "divider",
          background: "rgba(255, 255, 255, 0.96)",
          boxShadow: "0 18px 36px rgba(2, 50, 45, 0.08)",
          backdropFilter: "blur(12px)",
        }}
      >
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack spacing={3}>
            <Box>
              <Typography variant="h2" sx={{ mb: 1 }}>
                Bejelentkezés
              </Typography>
              <Typography color="text.secondary">
                Használja a céges Google-fiókját.
              </Typography>
            </Box>

            <Box
              sx={{
                height: 1,
                background:
                  "linear-gradient(90deg, rgba(58, 120, 93, 0.28), rgba(58, 120, 93, 0.06))",
              }}
            />

            <Typography variant="body2" color="text.secondary">
              Belépés céges Google-fiókkal.
            </Typography>

            <Box sx={{ display: "flex", justifyContent: "center" }}>
              {!googleClientId ? (
                <Alert severity="error" sx={{ width: "100%" }}>
                  Ehhez az alkalmazáshoz nincs beállítva Google kliensazonosító.
                </Alert>
              ) : (
                <GoogleSignInButton
                  clientId={googleClientId}
                  disabled={isAuthenticating}
                  width={320}
                  onCredential={loginWithGoogle}
                  onLoadError={() => {
                    window.alert("A Google bejelentkezési script nem tölthető be.");
                  }}
                />
              )}
            </Box>

            {isAuthenticating && (
              <Stack direction="row" spacing={1} justifyContent="center" alignItems="center">
                <CircularProgress size={18} />
                <Typography variant="body2" color="text.secondary">
                  Bejelentkezés folyamatban...
                </Typography>
              </Stack>
            )}

            <Typography variant="caption" color="text.secondary" textAlign="center">
              {productNames.labeling}
            </Typography>
          </Stack>
        </CardContent>
      </Card>
      </Box>

      <Box sx={{ px: 1, pb: 1 }}>
        <Typography variant="caption" color="text.secondary">
          Belső használatra
        </Typography>
      </Box>
    </Box>
  );
}
