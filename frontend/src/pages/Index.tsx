import { useNavigate } from "react-router-dom";
import { Box, Button, Card, CardContent, Typography } from "@mui/material";
import { ClipboardList, Play, Wrench } from "lucide-react";
import { Layout } from "@/components/Layout";
import { appColors } from "@/theme";
import { useMaintenance } from "@/context/MaintenanceContext";

const Index = () => {
  const navigate = useNavigate();
  const { currentWork, todaysWorks } = useMaintenance();

  const completedToday = todaysWorks.filter((work) => work.status === "completed").length;
  const inProgress = currentWork?.status === "in-progress";

  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3, animation: "slideUp 0.3s ease-out" }}>
        <Box
          sx={{
            display: "grid",
            gap: 3,
            alignItems: "center",
            gridTemplateColumns: { xs: "1fr", md: "1.1fr 0.9fr" },
          }}
        >
          <Box sx={{ textAlign: { xs: "center", md: "left" }, py: 1 }}>
          <Box
            sx={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 64,
              height: 64,
              bgcolor: "rgba(0, 0, 0, 0.04)",
              borderRadius: "50%",
              mb: 2,
            }}
          >
            <Wrench size={32} color={appColors.primary} />
          </Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Üdv újra
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Készen áll a karbantartás megkezdésére?
          </Typography>
          </Box>

          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 1.5 }}>
            <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
              <CardContent sx={{ textAlign: "center" }}>
                <Typography variant="h4" sx={{ fontWeight: 700, color: appColors.primary }}>
                  {completedToday}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Ma befejezett
                </Typography>
              </CardContent>
            </Card>
            <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
              <CardContent sx={{ textAlign: "center" }}>
                <Typography variant="h4" sx={{ fontWeight: 700, color: appColors.inProgress }}>
                  {inProgress ? 1 : 0}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Folyamatban
                </Typography>
              </CardContent>
            </Card>
          </Box>
        </Box>

        <Button
          variant="outlined"
          size="large"
          startIcon={<ClipboardList size={18} />}
          onClick={() => navigate("/overview")}
          fullWidth
          sx={{ display: { xs: "flex", md: "none" } }}
        >
          Mai áttekintés megtekintése
        </Button>

        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: { xs: "1fr", md: "1.3fr 0.7fr" },
            alignItems: "start",
          }}
        >
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {inProgress && currentWork && (
              <Card
                sx={{
                  border: `1px solid ${appColors.inProgress}`,
                  bgcolor: "rgba(64, 154, 178, 0.08)",
                  boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)",
                }}
              >
                <CardContent
                  sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}
                >
                  <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      Folyamatban lévő munka
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {currentWork.hvacId}
                    </Typography>
                  </Box>
                  <Button variant="contained" onClick={() => navigate(`/maintenance/${currentWork.id}`)}>
                    Folytatás
                  </Button>
                </CardContent>
              </Card>
            )}

            <Button
              variant="contained"
              size="large"
              startIcon={<Play size={20} />}
              onClick={() => navigate("/scan")}
              disabled={inProgress}
              fullWidth
              sx={{
                py: 1.5,
                bgcolor: appColors.accent,
                color: appColors.accentForeground,
                fontWeight: 700,
                "&:hover": { bgcolor: "hsl(36 95% 45%)" },
              }}
            >
              {inProgress ? "Először fejezze be az aktuális munkát" : "Karbantartás indítása"}
            </Button>
          </Box>
          <Button
            variant="outlined"
            size="large"
            startIcon={<ClipboardList size={18} />}
            onClick={() => navigate("/overview")}
            fullWidth
            sx={{ height: "100%", display: { xs: "none", md: "flex" } }}
          >
            Mai áttekintés megtekintése
          </Button>
        </Box>
      </Box>
    </Layout>
  );
};

export default Index;
