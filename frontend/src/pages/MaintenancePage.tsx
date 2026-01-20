import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  IconButton,
  Menu,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRightFromLine,
  ArrowRightToLine,
  CheckCircle,
  Blocks,
  Cpu,
  MapPin,
  MoreVertical,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { PhotoGallery } from "@/components/PhotoGallery";
import { PhotoUpload } from "@/components/PhotoUpload";
import { StatusBadge } from "@/components/StatusBadge";
import { useMaintenance } from "@/context/MaintenanceContext";
import { appColors } from "@/theme";
import { formatDateTime } from "@/lib/date";
import { toast } from "@/lib/toast";
import { deviceKindLabels, getDeviceKindIcon } from "@/lib/deviceKind";

export default function MaintenancePage() {
  const { workId } = useParams<{ workId: string }>();
  const navigate = useNavigate();
  const {
    todaysWorks,
    updateNotes,
    addPhoto,
    toggleMalfunction,
    completeMaintenance,
    abortMaintenance,
  } = useMaintenance();
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);

  const work = todaysWorks.find((item) => item.id === workId);

  if (!work) {
    return (
      <Layout>
        <Box sx={{ textAlign: "center", py: 8 }}>
          <Typography variant="body2" color="text.secondary">
            A munka nem található
          </Typography>
          <Button variant="text" onClick={() => navigate("/")}>
            Vissza a kezdőlapra
          </Button>
        </Box>
      </Layout>
    );
  }

  const isCompleted = work.status === "completed";

  const handleComplete = () => {
    if (work.photos.length === 0) {
      toast.error("A befejezéshez legalább egy fotót töltsön fel");
      return;
    }

    completeMaintenance(work.id);
    toast.success("Karbantartás befejezve!");
    navigate("/overview");
  };

  const handleAbort = () => {
    abortMaintenance(work.id);
    toast.info("A karbantartás megszakítva.");
    navigate("/");
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setMenuAnchor(event.currentTarget);
  };

  const handleMenuClose = () => {
    setMenuAnchor(null);
  };

  const kindLabel =
    deviceKindLabels[work.hvacKind as keyof typeof deviceKindLabels] ?? work.hvacKind;
  const KindIcon = getDeviceKindIcon(work.hvacKind);

  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3, animation: "slideUp 0.3s ease-out" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <IconButton onClick={() => navigate("/")}>
            <ArrowLeft size={18} />
          </IconButton>
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, pb: 2 }}>
              <Box sx={{ color: appColors.mutedForeground }}>
              <KindIcon size={36} />
              </Box>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {work.hvacId}
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}>
              <StatusBadge status={work.status} />
              {work.isMalfunctioning && <StatusBadge status="malfunction" />}
            </Box>
          </Box>
          {!isCompleted && (
            <IconButton onClick={handleMenuOpen} aria-label="További lehetőségek">
              <MoreVertical size={18} />
            </IconButton>
          )}
        </Box>
        <Box
          sx={{
            display: "grid",
            gap: 3,
            gridTemplateColumns: { xs: "1fr", md: "1.1fr 0.9fr" },
            alignItems: "start",
          }}
        >
          <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
              <CardHeader title="Egység adatai" titleTypographyProps={{ variant: "subtitle1", fontWeight: 700 }} />
              <CardContent>
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
                    gap: 0,
                  }}
                >
                  <Box sx={{ p: 1.5, borderRadius: 2 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                      <Box sx={{ p: 1, bgcolor: "rgba(0, 0, 0, 0.08)", borderRadius: 2 }}>
                        <Cpu size={18} color={appColors.primary} />
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Modell
                        </Typography>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {work.hvacModel}
                        </Typography>
                      </Box>
                    </Box>
                  </Box>
                  <Box sx={{ p: 1.5, borderRadius: 2 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                      <Box sx={{ p: 1, bgcolor: "rgba(0, 0, 0, 0.08)", borderRadius: 2 }}>
                        <Blocks size={18} color={appColors.primary} />
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Típus
                        </Typography>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {kindLabel}
                        </Typography>
                      </Box>
                    </Box>
                  </Box>
                  <Box sx={{ p: 1.5, borderRadius: 2 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                      <Box sx={{ p: 1, bgcolor: "rgba(0, 0, 0, 0.08)", borderRadius: 2 }}>
                        <MapPin size={18} color={appColors.primary} />
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Cím és helyszín
                        </Typography>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {work.hvacAddress}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {work.hvacLocation}
                        </Typography>
                      </Box>
                    </Box>
                  </Box>
                </Box>
              </CardContent>
            </Card>

            <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
              <CardHeader title="Karbantartás" titleTypographyProps={{ variant: "subtitle1", fontWeight: 700 }} />
              <CardContent>
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
                    gap: 0,
                  }}
                >
                  <Box sx={{ p: 1.5, borderRadius: 2 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                      <Box sx={{ p: 1, bgcolor: "rgba(0, 0, 0, 0.08)", borderRadius: 2 }}>
                        <ArrowRightFromLine size={18} color={appColors.primary} />
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Kezdete
                        </Typography>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {formatDateTime(work.startTime)}
                        </Typography>
                      </Box>
                    </Box>
                  </Box>
                  <Box sx={{ p: 1.5, borderRadius: 2 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                      <Box sx={{ p: 1, bgcolor: "rgba(0, 0, 0, 0.08)", borderRadius: 2 }}>
                        <ArrowRightToLine size={18} color={appColors.primary} />
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Befejezése
                        </Typography>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {work.endTime ? formatDateTime(work.endTime) : "-"}
                        </Typography>
                      </Box>
                    </Box>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Box>

          <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <Card
              sx={{
                boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)",
                border: work.isMalfunctioning ? `1px solid ${appColors.destructive}` : "none",
                bgcolor: work.isMalfunctioning ? "rgba(220, 40, 40, 0.06)" : undefined,
              }}
            >
              <CardContent sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <AlertTriangle
                      size={18}
                      color={work.isMalfunctioning ? appColors.destructive : appColors.mutedForeground}
                    />
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      Hibásként jelölés
                    </Typography>
                  </Box>
                  <Switch
                    checked={work.isMalfunctioning}
                    onChange={() => toggleMalfunction(work.id)}
                    disabled={isCompleted}
                  />
                </Box>
                {work.isMalfunctioning && (
                  <Typography variant="caption" sx={{ color: appColors.destructive }}>
                    Ez az egység javításra lesz jelölve
                  </Typography>
                )}
              </CardContent>
            </Card>

            <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
              <CardHeader title="Megjegyzések" titleTypographyProps={{ variant: "subtitle1", fontWeight: 700 }} />
              <CardContent>
                <TextField
                  placeholder="Írja le a megfigyeléseket, elvégzett feladatokat vagy talált problémákat..."
                  value={work.notes}
                  onChange={(event) => updateNotes(work.id, event.target.value)}
                  multiline
                  minRows={4}
                  fullWidth
                  disabled={isCompleted}
                />
              </CardContent>
            </Card>

            <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
              <CardHeader
                disableTypography
                title={
                  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      Fotók
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {work.photos.length} feltöltve
                    </Typography>
                  </Box>
                }
              />
              <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <PhotoGallery photos={work.photos} />
                {!isCompleted && <PhotoUpload onPhotoAdd={(photo) => addPhoto(work.id, photo)} />}
              </CardContent>
            </Card>

            {!isCompleted && (
              <Button
                variant="contained"
                size="large"
                startIcon={<CheckCircle size={18} />}
                onClick={handleComplete}
                disabled={work.photos.length === 0}
                fullWidth
                sx={{
                  bgcolor: appColors.success,
                  color: appColors.successForeground,
                  "&:hover": { bgcolor: "hsl(142 72% 38%)" },
                }}
              >
                Karbantartás befejezése
              </Button>
            )}
          </Box>
        </Box>

        <Menu
          anchorEl={menuAnchor}
          open={Boolean(menuAnchor)}
          onClose={handleMenuClose}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
        >
          <MenuItem
            onClick={() => {
              handleMenuClose();
              handleAbort();
            }}
            sx={{ color: appColors.destructive, fontWeight: 700 }}
          >
            Karbantartás megszakítása
          </MenuItem>
        </Menu>

        {work.photos.length === 0 && !isCompleted && (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
            A munka lezárásához töltsön fel legalább egy fotót
          </Typography>
        )}
      </Box>
    </Layout>
  );
}
