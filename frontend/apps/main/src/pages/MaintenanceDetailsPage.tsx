import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Card,
  CardContent,
  CardHeader,
  Chip,
  CircularProgress,
  IconButton,
  Typography,
} from "@mui/material";
import {
    AlertTriangle,
  ArrowLeft,
  ArrowRightFromLine,
  ArrowRightToLine,
  Blocks,
  Cpu,
  HardHat,
  MapPin,
  ScanBarcode,
} from "lucide-react";
import { getDeviceKindLabel } from "@noma/shared";
import { Layout } from "@/components/Layout";
import { PhotoGallery } from "@/components/PhotoGallery";
import { StatusBadge } from "@/components/StatusBadge";
import { getDeviceKindIcon } from "@/lib/deviceKind";
import { formatDateTime } from "@/lib/date";
import { appColors } from "@/theme";
import {
  followupServiceReasonLabels,
  type MaintenancePhoto,
} from "@/types/maintenance";

type MaintenancePhotoPayload = {
  photo_id: string;
  photo_type: string;
  photo_url: string;
  capture_note: string | null;
  captured_at: string;
};

type MaintenanceDetailsPayload = {
  maintenance_id: string;
  shift_id: string;
  maintenance_status: string;
  barcode: string | null;
  kind: string;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  source_device_code: string | null;
  maintainer_user_name: string;
  started_at: string;
  finished_at: string | null;
  aborted_at: string | null;
  malfunction_description: string | null;
  followup_service_required: boolean;
  followup_service_reasons: string[];
  followup_service_reason_other: string | null;
  note: string | null;
  building_name: string;
  building_address: string;
  floor: string | null;
  wing: string | null;
  room: string | null;
  location_description: string | null;
  photos: MaintenancePhotoPayload[];
};

const readApiErrorMessage = async (response: Response, fallback: string) => {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // Ignore malformed payloads.
  }
  return fallback;
};

const formatLocation = (payload: MaintenanceDetailsPayload) => {
  const parts = [
    payload.floor?.trim(),
    payload.wing?.trim(),
    payload.room?.trim(),
    payload.location_description?.trim(),
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" / ") : "-";
};

const formatBrandType = (payload: MaintenanceDetailsPayload) => {
  const parts = [payload.brand?.trim(), payload.model?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "-";
};

const asDate = (value: string | null) => (value ? new Date(value) : null);

const maintenanceStatusLabel: Record<string, string> = {
  IN_PROGRESS: "Folyamatban",
  FINISHED: "Befejezve",
  ABORTED: "Megszakítva",
};

const formatFollowupReasons = (payload: MaintenanceDetailsPayload) =>
  payload.followup_service_reasons.map((reason) => {
    const label = followupServiceReasonLabels[reason as keyof typeof followupServiceReasonLabels];
    return label ?? reason;
  });

export default function MaintenanceDetailsPage() {
  const navigate = useNavigate();
  const { shiftId, maintenanceId } = useParams<{ shiftId: string; maintenanceId: string }>();
  const [payload, setPayload] = useState<MaintenanceDetailsPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!shiftId || !maintenanceId) {
        setPayload(null);
        setError("A karbantartás azonosítója hiányzik.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/admin/shifts/${shiftId}/maintenances/${maintenanceId}`, {
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(await readApiErrorMessage(response, "Nem sikerült betölteni a karbantartás részleteit."));
        }
        const nextPayload = (await response.json()) as MaintenanceDetailsPayload;
        if (!cancelled) {
          setPayload(nextPayload);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Nem sikerült betölteni a karbantartás részleteit.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [maintenanceId, shiftId]);

  const galleryPhotos = useMemo<MaintenancePhoto[]>(
    () =>
      (payload?.photos ?? []).map((photo) => ({
        id: photo.photo_id,
        url: photo.photo_url,
        description: photo.capture_note ?? (photo.photo_type === "MALFUNCTION" ? "Hibafotó" : "Karbantartási fotó"),
        timestamp: new Date(photo.captured_at),
      })),
    [payload],
  );

  if (isLoading) {
    return (
      <Layout>
        <Box sx={{ py: 8, display: "grid", placeItems: "center" }}>
          <CircularProgress color="secondary" />
        </Box>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <IconButton onClick={() => navigate(shiftId ? `/admin/shifts/${shiftId}` : "/admin/shifts")} aria-label="Vissza">
              <ArrowLeft size={18} />
            </IconButton>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>
              Karbantartás részletei
            </Typography>
          </Box>
          <Alert severity="error">{error}</Alert>
        </Box>
      </Layout>
    );
  }

  if (!payload) {
    return (
      <Layout>
        <Alert severity="info">A karbantartás nem található.</Alert>
      </Layout>
    );
  }

  const KindIcon = getDeviceKindIcon(payload.kind);
  const startedAt = asDate(payload.started_at);
  const finishedAt = asDate(payload.finished_at);
  const abortedAt = asDate(payload.aborted_at);
  const followupReasons = formatFollowupReasons(payload);

  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3, animation: "slideUp 0.3s ease-out" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <IconButton onClick={() => navigate(`/admin/shifts/${payload.shift_id}`)} aria-label="Vissza">
            <ArrowLeft size={18} />
          </IconButton>
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, pb: 2 }}>
              <Box sx={{ color: appColors.primary }}>
                <KindIcon size={36} />
              </Box>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {payload.barcode ?? "Vonalkód nélkül"}
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5, flexWrap: "wrap" }}>
              {payload.maintenance_status === "IN_PROGRESS" ? <StatusBadge status="in-progress" /> : null}
              {payload.maintenance_status === "FINISHED" ? <StatusBadge status="completed" /> : null}
              {payload.maintenance_status === "ABORTED" ? (
                <Chip
                  label={maintenanceStatusLabel[payload.maintenance_status]}
                  size="small"
                  sx={{
                    bgcolor: appColors.muted,
                    color: appColors.foreground,
                    fontWeight: 700,
                    fontSize: 11,
                    height: 24,
                  }}
                />
              ) : null}
              {payload.followup_service_required ? (
                <Chip
                  label="További szervíz szükséges"
                  size="small"
                  sx={{
                    bgcolor: "rgba(245, 158, 11, 0.18)",
                    color: appColors.foreground,
                    fontWeight: 700,
                    fontSize: 11,
                    height: 24,
                  }}
                />
              ) : null}
            </Box>
          </Box>
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
                          Márka + típus
                        </Typography>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {formatBrandType(payload)}
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
                          Berendezés típusa
                        </Typography>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {getDeviceKindLabel(payload.kind) ?? payload.kind}
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
                          Épület és helyszín
                        </Typography>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {payload.building_name}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {payload.building_address}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {formatLocation(payload)}
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
                        <ScanBarcode size={18} color={appColors.primary} />
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Azonosítók
                        </Typography>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          Vonalkód: {payload.barcode ?? "-"}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Gyári szám: {payload.serial_number ?? "-"}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Forráskód: {payload.source_device_code ?? "-"}
                        </Typography>
                      </Box>
                    </Box>
                  </Box>
                </Box>
              </CardContent>
            </Card>

            <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
              <CardHeader title="Fotók" titleTypographyProps={{ variant: "subtitle1", fontWeight: 700 }} />
              <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  {galleryPhotos.length} feltöltve
                </Typography>
                <PhotoGallery photos={galleryPhotos} />
              </CardContent>
            </Card>
          </Box>

          <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
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
                        <HardHat size={18} color={appColors.primary} />
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Karbantartó
                        </Typography>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {payload.maintainer_user_name}
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
                        <ArrowRightFromLine size={18} color={appColors.primary} />
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Kezdete
                        </Typography>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {startedAt ? formatDateTime(startedAt) : "-"}
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
                        <ArrowRightToLine size={18} color={appColors.primary} />
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Befejezése
                        </Typography>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {finishedAt ? formatDateTime(finishedAt) : "-"}
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
                        <AlertTriangle size={18} color={abortedAt ? appColors.destructive : appColors.primary} />
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Megszakítás ideje
                        </Typography>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {abortedAt ? formatDateTime(abortedAt) : "-"}
                        </Typography>
                      </Box>
                    </Box>
                  </Box>
                </Box>
              </CardContent>
            </Card>

            {payload.followup_service_required ? (
              <Card
                sx={{
                  boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)",
                  border: "1px solid rgba(245, 158, 11, 0.32)",
                  bgcolor: "rgba(245, 158, 11, 0.08)",
                }}
              >
                <CardHeader
                  title="További szervíz szükséges"
                  titleTypographyProps={{ variant: "subtitle1", fontWeight: 700 }}
                />
                <CardContent sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  {followupReasons.map((reason) => (
                    <Typography key={reason} variant="body2">
                      {reason}
                    </Typography>
                  ))}
                  {payload.followup_service_reasons.includes("OTHER") &&
                  payload.followup_service_reason_other?.trim() ? (
                    <Typography variant="body2" color="text.secondary">
                      Egyéb: {payload.followup_service_reason_other}
                    </Typography>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
              <CardHeader title="Megjegyzések" titleTypographyProps={{ variant: "subtitle1", fontWeight: 700 }} />
              <CardContent>
                <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: appColors.muted }}>
                  <Typography variant="body2" color="text.secondary">
                    {payload.note?.trim() || "Nincs megjegyzés."}
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Box>
        </Box>
      </Box>
    </Layout>
  );
}
