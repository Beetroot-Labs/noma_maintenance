import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Box, Button, Card, CardContent, Typography } from "@mui/material";
import { ClipboardCheck } from "lucide-react";
import { WorkCard } from "@/components/WorkCard";
import { Layout } from "@/components/Layout";
import { useMaintenance } from "@/context/MaintenanceContext";
import { useShift } from "@/context/ShiftContext";
import { appColors } from "@/theme";

export default function MaintenanceDashboard() {
  const navigate = useNavigate();
  const { todaysWorks, canConfirmShiftClose } = useMaintenance();
  const { currentShift, refreshCurrentShift } = useShift();
  const [isConfirmingClose, setIsConfirmingClose] = useState(false);
  const attemptedCloseConfirmRef = useRef<string | null>(null);
  const orderedWorks = useMemo(
    () =>
      [...todaysWorks].sort(
        (left, right) => right.startTime.getTime() - left.startTime.getTime(),
      ),
    [todaysWorks],
  );
  const isCloseRequested =
    currentShift?.status === "CLOSE_REQUESTED" || currentShift?.status === "READY_TO_COMMIT";
  const canStartNewMaintenance = !isCloseRequested;

  useEffect(() => {
    if (
      !currentShift ||
      !navigator.onLine ||
      !canConfirmShiftClose ||
      currentShift.my_participant_status === "CLOSE_CONFIRMED" ||
      (currentShift.status !== "CLOSE_REQUESTED" && currentShift.status !== "READY_TO_COMMIT")
    ) {
      attemptedCloseConfirmRef.current = null;
      return;
    }

    const requestKey = `${currentShift.id}:${currentShift.status}:${currentShift.my_participant_status}`;
    if (attemptedCloseConfirmRef.current === requestKey || isConfirmingClose) {
      return;
    }

    attemptedCloseConfirmRef.current = requestKey;
    setIsConfirmingClose(true);

    void fetch(`/api/shifts/${currentShift.id}/close-confirm`, {
      method: "POST",
      credentials: "include",
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Nem sikerült megerősíteni a műszak lezárását.");
        }
        await refreshCurrentShift();
      })
      .catch(() => {
        attemptedCloseConfirmRef.current = null;
      })
      .finally(() => {
        setIsConfirmingClose(false);
      });
  }, [canConfirmShiftClose, currentShift, isConfirmingClose, refreshCurrentShift]);

  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {isCloseRequested ? (
          <Alert severity="warning">
            {currentShift?.lead_user_name} lezárta a műszakot. Új karbantartási munka már nem
            indítható!
            {currentShift?.my_participant_status !== "CLOSE_CONFIRMED" && canConfirmShiftClose
              ? " A szinkron megerősítése folyamatban van."
              : null}
          </Alert>
        ) : null}
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
                <Button
                  variant="text"
                  onClick={() => navigate("/new-maintenance")}
                  disabled={!canStartNewMaintenance}
                  sx={{ mt: 1 }}
                >
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
