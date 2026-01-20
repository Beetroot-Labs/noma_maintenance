import { useNavigate, useParams } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  IconButton,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  Clock,
  Cpu,
  MapPin,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { PhotoGallery } from "@/components/PhotoGallery";
import { PhotoUpload } from "@/components/PhotoUpload";
import { StatusBadge } from "@/components/StatusBadge";
import { useMaintenance } from "@/context/MaintenanceContext";
import { appColors } from "@/theme";
import { formatDateTime } from "@/lib/date";
import { toast } from "@/lib/toast";

export default function MaintenancePage() {
  const { workId } = useParams<{ workId: string }>();
  const navigate = useNavigate();
  const { todaysWorks, updateNotes, addPhoto, toggleMalfunction, completeMaintenance } =
    useMaintenance();

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

  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3, animation: "slideUp 0.3s ease-out" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <IconButton onClick={() => navigate("/")}>
            <ArrowLeft size={18} />
          </IconButton>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {work.hvacId}
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}>
              <StatusBadge status={work.status} />
              {work.isMalfunctioning && <StatusBadge status="malfunction" />}
            </Box>
          </Box>
        </Box>

        <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
          <CardHeader title="Egység adatai" titleTypographyProps={{ variant: "subtitle1", fontWeight: 700 }} />
          <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
              <Box sx={{ p: 1, bgcolor: "rgba(0, 0, 0, 0.06)", borderRadius: 2 }}>
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
            <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
              <Box sx={{ p: 1, bgcolor: "rgba(0, 0, 0, 0.06)", borderRadius: 2 }}>
                <MapPin size={18} color={appColors.primary} />
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Helyszín
                </Typography>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  {work.hvacLocation}
                </Typography>
              </Box>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
              <Box sx={{ p: 1, bgcolor: "rgba(0, 0, 0, 0.06)", borderRadius: 2 }}>
                <Clock size={18} color={appColors.primary} />
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Kezdés
                </Typography>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  {formatDateTime(work.startTime)}
                </Typography>
              </Box>
            </Box>
          </CardContent>
        </Card>

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
              "&:hover": { bgcolor: "hsl(155 45% 38%)" },
            }}
          >
            Karbantartás befejezése
          </Button>
        )}

        {work.photos.length === 0 && !isCompleted && (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
            A munka lezárásához töltsön fel legalább egy fotót
          </Typography>
        )}
      </Box>
    </Layout>
  );
}
