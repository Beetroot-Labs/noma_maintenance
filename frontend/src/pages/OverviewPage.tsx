import { useNavigate } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import { AlertTriangle, CheckCircle, ClipboardCheck, Clock, Phone, User } from "lucide-react";
import { Layout } from "@/components/Layout";
import { WorkCard } from "@/components/WorkCard";
import { useMaintenance } from "@/context/MaintenanceContext";
import { appColors } from "@/theme";
import { toast } from "@/lib/toast";
import { useState } from "react";

export default function OverviewPage() {
  const navigate = useNavigate();
  const { todaysWorks, shiftManager, closeWorkday } = useMaintenance();
  const [dialogOpen, setDialogOpen] = useState(false);

  const completedWorks = todaysWorks.filter((work) => work.status === "completed");
  const inProgressWorks = todaysWorks.filter((work) => work.status === "in-progress");
  const malfunctioningCount = todaysWorks.filter((work) => work.isMalfunctioning).length;

  const handleCloseWorkday = () => {
    closeWorkday();
    toast.success("A munkanap sikeresen lezárva!");
    setDialogOpen(false);
    navigate("/");
  };

  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3, animation: "slideUp 0.3s ease-out" }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          Mai áttekintés
        </Typography>

        <Card
          sx={{
            boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)",
            bgcolor: appColors.primary,
            color: appColors.primaryForeground,
          }}
        >
          <CardContent sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
              <Box
                sx={{
                  p: 1,
                  borderRadius: "50%",
                  bgcolor: "rgba(255, 255, 255, 0.2)",
                  display: "flex",
                }}
              >
                <User size={18} />
              </Box>
              <Box>
                <Typography variant="caption" sx={{ opacity: 0.8 }}>
                  Műszakvezető
                </Typography>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  {shiftManager.name}
                </Typography>
              </Box>
            </Box>
            <Button
              component="a"
              href={`tel:${shiftManager.phone}`}
              sx={{
                bgcolor: "rgba(255, 255, 255, 0.2)",
                color: appColors.primaryForeground,
                "&:hover": { bgcolor: "rgba(255, 255, 255, 0.3)" },
              }}
              startIcon={<Phone size={16} />}
            >
              Hívás
            </Button>
          </CardContent>
        </Card>

        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1.5 }}>
          <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
            <CardContent sx={{ textAlign: "center" }}>
              <CheckCircle size={20} color={appColors.success} />
              <Typography variant="h5" sx={{ fontWeight: 700, mt: 0.5 }}>
                {completedWorks.length}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Kész
              </Typography>
            </CardContent>
          </Card>
          <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
            <CardContent sx={{ textAlign: "center" }}>
              <Clock size={20} color={appColors.inProgress} />
              <Typography variant="h5" sx={{ fontWeight: 700, mt: 0.5 }}>
                {inProgressWorks.length}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Folyamatban
              </Typography>
            </CardContent>
          </Card>
          <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
            <CardContent sx={{ textAlign: "center" }}>
              <AlertTriangle size={20} color={appColors.destructive} />
              <Typography variant="h5" sx={{ fontWeight: 700, mt: 0.5 }}>
                {malfunctioningCount}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Hibák
              </Typography>
            </CardContent>
          </Card>
        </Box>

        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <ClipboardCheck size={18} color={appColors.primary} />
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Karbantartási munkák
            </Typography>
          </Box>
          {todaysWorks.length === 0 ? (
            <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
              <CardContent sx={{ textAlign: "center", py: 4 }}>
                <Typography variant="body2" color="text.secondary">
                  Ma még nincs karbantartási munka
                </Typography>
                <Button variant="text" onClick={() => navigate("/")} sx={{ mt: 1 }}>
                  Kezdje el az első munkát
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {todaysWorks.map((work) => (
                <WorkCard key={work.id} work={work} />
              ))}
            </Box>
          )}
        </Box>

        {todaysWorks.length > 0 && inProgressWorks.length === 0 && (
          <>
            <Button
              variant="contained"
              size="large"
              onClick={() => setDialogOpen(true)}
              fullWidth
              sx={{
                bgcolor: appColors.destructive,
                color: appColors.destructiveForeground,
                "&:hover": { bgcolor: "hsl(0 55% 50%)" },
              }}
            >
              Munkanap lezárása
            </Button>
            <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
              <DialogTitle>Munkanap lezárása?</DialogTitle>
              <DialogContent>
                <Typography variant="body2" color="text.secondary">
                  Ezzel leadja a mai összes karbantartási munkát. Ma {completedWorks.length}{" "}
                  munkát fejezett be.
                </Typography>
                {malfunctioningCount > 0 && (
                  <Typography variant="body2" sx={{ mt: 1, color: appColors.destructive }}>
                    {malfunctioningCount} egység hibásként lett megjelölve.
                  </Typography>
                )}
              </DialogContent>
              <DialogActions sx={{ px: 3, pb: 2 }}>
                <Button variant="outlined" onClick={() => setDialogOpen(false)}>
                  Mégse
                </Button>
                <Button variant="contained" onClick={handleCloseWorkday}>
                  Jóváhagyás és lezárás
                </Button>
              </DialogActions>
            </Dialog>
          </>
        )}

        {inProgressWorks.length > 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
            A munkanap lezárása előtt fejezze be az összes folyamatban lévő munkát
          </Typography>
        )}
      </Box>
    </Layout>
  );
}
