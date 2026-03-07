import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, Card, CardContent, Typography } from "@mui/material";
import { ClipboardCheck } from "lucide-react";
import { WorkCard } from "@/components/WorkCard";
import { Layout } from "@/components/Layout";
import { useMaintenance } from "@/context/MaintenanceContext";
import { appColors } from "@/theme";

export default function MaintenanceDashboard() {
  const navigate = useNavigate();
  const { todaysWorks } = useMaintenance();
  const orderedWorks = useMemo(
    () =>
      [...todaysWorks].sort(
        (left, right) => right.startTime.getTime() - left.startTime.getTime(),
      ),
    [todaysWorks],
  );

  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <ClipboardCheck size={18} color={appColors.primary} />
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Karbantartási munkák
            </Typography>
          </Box>
          {orderedWorks.length === 0 ? (
            <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
              <CardContent sx={{ textAlign: "center", py: 4 }}>
                <Typography variant="body2" color="text.secondary">
                  Ma még nincs karbantartási munka
                </Typography>
                <Button variant="text" onClick={() => navigate("/new-maintenance")} sx={{ mt: 1 }}>
                  Kezdje el az első munkát
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {orderedWorks.map((work) => (
                <WorkCard
                  key={work.id}
                  work={work}
                  to={`/maintenance/${work.id}`}
                  hideAddress
                />
              ))}
            </Box>
          )}
        </Box>
      </Box>
    </Layout>
  );
}
