import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Badge, Box, Button, Card, CardActionArea, CardContent, CircularProgress, Typography } from "@mui/material";
import { ChevronRight, ClipboardList, HardHat, Plus, Radio, Users } from "lucide-react";
import { Layout } from "@/components/Layout";
import { useDemoUser } from "@/context/DemoUserContext";
import { useShift } from "@/context/ShiftContext";
import { appColors } from "@/theme";

const waitingStatusLabel: Record<string, string> = {
  INVITED: "Meghívást kapott egy műszakhoz.",
  ACCEPTED: "Belépett a műszakba.",
  CACHE_READY: "A műszak előkészítése kész.",
  DECLINED: "A műszak meghívása elutasítva.",
  CLOSE_CONFIRMED: "A műszak lezárása megerősítve.",
};

export default function ShiftHomePage() {
  const navigate = useNavigate();
  const { user } = useDemoUser();
  const { currentShift, isLoading } = useShift();
  const isLeadOrAdmin = user?.role === "admin" || user?.role === "lead_technician";
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  useEffect(() => {
    if (!isLeadOrAdmin) return;
    fetch("/api/shifts/pending", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: unknown[]) => setPendingCount(rows.length))
      .catch(() => {});
  }, [isLeadOrAdmin]);

  if (isLoading) {
    return (
      <Layout>
        <Box sx={{ minHeight: "50vh", display: "grid", placeItems: "center" }}>
          <CircularProgress color="secondary" />
        </Box>
      </Layout>
    );
  }

  if (
    currentShift?.status === "IN_PROGRESS" ||
    currentShift?.status === "CLOSE_REQUESTED"
  ) {
    return <Navigate to="/dashboard" replace />;
  }

  const canStartShift = isLeadOrAdmin;

  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            Műszak állapot
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Itt látható, hogy van-e aktív műszak, és innen lehet továbblépni.
          </Typography>
        </Box>

        {!currentShift ? (
          <Card sx={{ boxShadow: "0 14px 36px rgba(15, 23, 42, 0.08)" }}>
            <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2.5, py: 4 }}>
              <Box
                sx={{
                  width: 56,
                  height: 56,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: "50%",
                  bgcolor: "rgba(15, 23, 42, 0.05)",
                  color: appColors.primary,
                }}
              >
                <Radio size={24} />
              </Box>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  Nincs aktív műszak
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {canStartShift
                    ? "Jelenleg nincs futó vagy előkészítés alatt álló műszak."
                    : "Jelenleg nincs aktív műszak. Amint a műszakvezető létrehoz egyet, itt megjelenik."}
                </Typography>
              </Box>
              {canStartShift ? (
                <Button
                  variant="contained"
                  startIcon={<Plus size={18} />}
                  onClick={() => navigate("/shifts/start")}
                  sx={{ alignSelf: "flex-start" }}
                >
                  Új műszak indítása
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <Card sx={{ boxShadow: "0 14px 36px rgba(15, 23, 42, 0.08)" }}>
            <CardActionArea onClick={() => navigate(`/shifts/${currentShift.id}/waiting-room`)}>
              <CardContent sx={{ display: "flex", alignItems: "center", gap: 2, py: 3 }}>
                <Box
                  sx={{
                    width: 56,
                    height: 56,
                    display: "grid",
                    placeItems: "center",
                    borderRadius: "50%",
                    bgcolor: "rgba(239, 164, 35, 0.14)",
                    color: appColors.accentForeground,
                  }}
                >
                  {user?.id && currentShift.lead_user_name ? <HardHat size={24} /> : <Users size={24} />}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    {currentShift.building_name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {waitingStatusLabel[currentShift.my_participant_status] ??
                      "Aktív műszak várószoba érhető el."}
                  </Typography>
                </Box>
                <ChevronRight size={20} color={appColors.primary} />
              </CardContent>
            </CardActionArea>
          </Card>
        )}

        {isLeadOrAdmin ? (
          <Card sx={{ boxShadow: "0 14px 36px rgba(15, 23, 42, 0.08)" }}>
            <CardActionArea onClick={() => navigate("/pending-worksheets")}>
              <CardContent sx={{ display: "flex", alignItems: "center", gap: 2, py: 3 }}>
                <Box
                  sx={{
                    width: 56,
                    height: 56,
                    display: "grid",
                    placeItems: "center",
                    borderRadius: "50%",
                    bgcolor: pendingCount ? "rgba(239, 164, 35, 0.14)" : "rgba(15, 23, 42, 0.05)",
                    color: pendingCount ? appColors.accentForeground : appColors.primary,
                    flexShrink: 0,
                  }}
                >
                  <Badge badgeContent={pendingCount ?? 0} color="error">
                    <ClipboardList size={24} />
                  </Badge>
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    Aláírandó munkalapok
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {pendingCount === null
                      ? "Betöltés..."
                      : pendingCount === 0
                        ? "Nincs aláírandó munkalap."
                        : pendingCount === 1
                          ? "1 műszak munkalapja vár aláírásra."
                          : `${pendingCount} műszak munkalapja vár aláírásra.`}
                  </Typography>
                </Box>
                <ChevronRight size={20} color={appColors.primary} />
              </CardContent>
            </CardActionArea>
          </Card>
        ) : null}
      </Box>
    </Layout>
  );
}
