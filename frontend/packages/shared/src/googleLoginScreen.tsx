import {
  Alert,
  Box,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import { GoogleSignInButton } from "./googleIdentity";

type GoogleLoginScreenProps = {
  googleClientId: string;
  title: string;
  overline?: string;
  isAuthenticating: boolean;
  onCredential: (credential: string) => void | Promise<void>;
  onLoadError?: () => void;
};

export function GoogleLoginScreen({
  googleClientId,
  title,
  overline = "NoMa Karbantartás",
  isAuthenticating,
  onCredential,
  onLoadError,
}: GoogleLoginScreenProps) {
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
          {overline}
        </Typography>
        <Typography variant="h1" sx={{ mt: 1, mb: 1 }}>
          {title}
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
                <Typography variant="h2">Bejelentkezés</Typography>
              </Box>

              <Typography variant="body2" color="text.secondary">
                Az alkalmazásba nomahutes.hu fiókoddal tudsz bejelentkezni.
              </Typography>

              <Box
                sx={{
                  display: "flex",
                  justifyContent: "center",
                  px: 9,
                }}
              >
                {!googleClientId ? (
                  <Alert severity="error" sx={{ width: "100%" }}>
                    Ehhez az alkalmazáshoz nincs beállítva Google kliensazonosító.
                  </Alert>
                ) : (
                  <GoogleSignInButton
                    clientId={googleClientId}
                    disabled={isAuthenticating}
                    onCredential={onCredential}
                    onLoadError={onLoadError}
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
            </Stack>
          </CardContent>
        </Card>
      </Box>

      <Box sx={{ px: 1, pb: 1 }}>
        <Typography variant="caption" color="text.secondary">
          &copy; {new Date().getFullYear()} NoMa Kft.
        </Typography>
      </Box>
    </Box>
  );
}
