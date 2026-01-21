import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  IconButton,
  Typography,
} from "@mui/material";
import { ArrowLeft, Blocks, Cpu, MapPin } from "lucide-react";
import { Layout } from "@/components/Layout";
import { PhotoGallery } from "@/components/PhotoGallery";
import { hvacDatabase, useMaintenance } from "@/context/MaintenanceContext";
import { getDeviceKindIcon, getDeviceKindLabel } from "@/lib/deviceKind";
import { formatDateTime } from "@/lib/date";
import { appColors } from "@/theme";

export default function DeviceDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { todaysWorks, pastWorks } = useMaintenance();

  const device = id ? hvacDatabase[id] : undefined;

  const maintenanceItems = useMemo(() => {
    if (!id) return [];
    return [...todaysWorks, ...pastWorks]
      .filter((work) => work.hvacId === id)
      .sort((a, b) => {
        const aTime = a.endTime?.getTime() ?? a.startTime.getTime();
        const bTime = b.endTime?.getTime() ?? b.startTime.getTime();
        return bTime - aTime;
      });
  }, [id, pastWorks, todaysWorks]);

  if (!id || !device) {
    return (
      <Layout>
        <Box sx={{ textAlign: "center", py: 8 }}>
          <Typography variant="body2" color="text.secondary">
            Az eszköz nem található
          </Typography>
          <Button variant="text" onClick={() => navigate("/devices")}>
            Vissza az eszközökhöz
          </Button>
        </Box>
      </Layout>
    );
  }

  const kindLabel = getDeviceKindLabel(device.kind as Parameters<typeof getDeviceKindLabel>[0]) ?? device.kind;
  const KindIcon = getDeviceKindIcon(device.kind);

  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3, animation: "slideUp 0.3s ease-out" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <IconButton onClick={() => navigate("/devices")}>
            <ArrowLeft size={18} />
          </IconButton>
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, pb: 2 }}>
              <Box sx={{ color: appColors.primary }}>
                <KindIcon size={36} />
              </Box>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {id}
              </Typography>
            </Box>
          </Box>
        </Box>

        <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
          <CardHeader title="Egység adatai" titleTypographyProps={{ variant: "subtitle1", fontWeight: 700 }} />
          <CardContent>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", md: "repeat(3, minmax(0, 1fr))" },
                gap: 0,
              }}
            >
              <Box sx={{ p: 1.5, borderRadius: 2 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                  <Box
                    sx={{
                      width: 32,
                      height: 32,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      bgcolor: "rgba(0, 0, 0, 0.08)",
                      borderRadius: 2,
                    }}
                  >
                    <Cpu size={18} color={appColors.primary} />
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Modell
                    </Typography>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      {device.model}
                    </Typography>
                  </Box>
                </Box>
              </Box>
              <Box sx={{ p: 1.5, borderRadius: 2 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                  <Box
                    sx={{
                      width: 32,
                      height: 32,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      bgcolor: "rgba(0, 0, 0, 0.08)",
                      borderRadius: 2,
                    }}
                  >
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
                  <Box
                    sx={{
                      width: 32,
                      height: 32,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      bgcolor: "rgba(0, 0, 0, 0.08)",
                      borderRadius: 2,
                    }}
                  >
                    <MapPin size={18} color={appColors.primary} />
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Cím és helyszín
                    </Typography>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      {device.address}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {device.location}
                    </Typography>
                  </Box>
                </Box>
              </Box>
            </Box>
          </CardContent>
        </Card>

        <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
          <CardHeader
            disableTypography
            title={
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Karbantartások
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {maintenanceItems.length} esemény
                </Typography>
              </Box>
            }
          />
          <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {maintenanceItems.length === 0 ? (
              <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: appColors.muted, textAlign: "center" }}>
                <Typography variant="body2" color="text.secondary">
                  Nincs karbantartás rögzítve ehhez az eszközhöz.
                </Typography>
              </Box>
            ) : (
              maintenanceItems.map((work) => {
                const label = formatDateTime(work.endTime ?? work.startTime);
                return (
                  <Card key={work.id} variant="outlined" sx={{ borderColor: appColors.border }}>
                    <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 2 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                          {label}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {work.photos.length} fotó
                        </Typography>
                      </Box>
                      {work.photos.length > 0 ? (
                        <PhotoGallery photos={work.photos} />
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          Nincs csatolt fotó.
                        </Typography>
                      )}
                    </CardContent>
                  </Card>
                );
              })
            )}
          </CardContent>
        </Card>
      </Box>
    </Layout>
  );
}
