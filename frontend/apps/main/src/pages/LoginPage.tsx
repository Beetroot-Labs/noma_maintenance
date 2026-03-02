import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import { ShieldAlert } from "lucide-react";
import { appColors } from "@/theme";
import { alpha } from "@mui/material/styles";
import { useDemoUser } from "@/context/DemoUserContext";
import { useMaintenance } from "@/context/MaintenanceContext";
import { toast } from "@/lib/toast";

const roleLabel = {
  admin: "admin",
  technician: "technikus",
  partner: "partner",
};

export default function LoginPage() {
  const navigate = useNavigate();
  const { user, users, selectUser } = useDemoUser();
  const { resetMaintenance } = useMaintenance();

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
                Demo bejelentkezés
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Ez csak egy mockup alkalmazás.
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
                  A bemutatóhoz előre definiált felhasználók közül választhat.
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Válasszon szerepkört a demózáshoz, majd lépjen be.
              </Typography>
            </CardContent>
          </Card>
        </Box>

        <Card sx={{ boxShadow: "0 12px 30px rgba(31, 50, 58, 0.12)" }}>
          <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Stack spacing={1.5}>
              {users.map((demoUser) => (
                <Card
                  key={demoUser.id}
                  variant="outlined"
                  sx={{
                    borderColor: appColors.border,
                    "&:hover": { borderColor: appColors.primary, boxShadow: "0 8px 18px rgba(0,0,0,0.08)" },
                  }}
                >
                  <CardContent
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 2,
                    }}
                  >
                    <Box>
                      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                        {demoUser.name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Szerepkör: {roleLabel[demoUser.role]}
                      </Typography>
                    </Box>
                    <Chip
                      label={roleLabel[demoUser.role]}
                      sx={{
                        bgcolor: appColors.secondary,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        fontSize: 11,
                      }}
                    />
                  </CardContent>
                  <Box sx={{ px: 2, pb: 2 }}>
                    <Button
                      variant="contained"
                      fullWidth
                      onClick={() => {
                        selectUser(demoUser);
                        navigate("/");
                      }}
                      sx={{ bgcolor: appColors.primary, color: appColors.primaryForeground }}
                    >
                      Belépés ezzel a felhasználóval
                    </Button>
                  </Box>
                </Card>
              ))}
            </Stack>
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
