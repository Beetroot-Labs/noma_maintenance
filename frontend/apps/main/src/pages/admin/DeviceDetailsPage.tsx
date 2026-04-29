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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { ArrowLeft, Barcode, Blocks, CalendarClock, Cpu, Hash, ImageIcon, MapPin, PencilRuler } from "lucide-react";
import { Layout } from "@/components/Layout";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/date";
import { getDeviceKindIcon, getDeviceKindLabel } from "@/lib/deviceKind";
import { appColors } from "@/theme";

type AdminDeviceMaintenanceHistoryRow = {
  maintenance_id: string;
  shift_id: string;
  status: string;
  maintainer_user_name: string;
  started_at: string;
  finished_at: string | null;
  aborted_at: string | null;
};

type AdminDeviceDetailPayload = {
  device_id: string;
  barcode: string | null;
  barcode_count: number;
  building_name: string;
  building_address: string;
  wing: string | null;
  floor: string | null;
  room: string | null;
  location_description: string | null;
  kind: string;
  original_kind: string | null;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  source_device_code: string | null;
  additional_info: string | null;
  is_maintainable: boolean;
  device_photo_url: string | null;
  created_at: string;
  latest_maintenance_at: string | null;
  maintenance_count: number;
  maintenances: AdminDeviceMaintenanceHistoryRow[];
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

const renderText = (value: string | null) => value?.trim() || "N/A";

const formatLocation = (payload: AdminDeviceDetailPayload) => {
  const parts = [payload.floor?.trim(), payload.wing?.trim(), payload.room?.trim()].filter(Boolean);
  const primary = parts.length > 0 ? parts.join(" / ") : null;
  const secondary = payload.location_description?.trim() || null;

  if (primary && secondary) {
    return `${primary} (${secondary})`;
  }

  return primary || secondary || "N/A";
};

const formatBrandModel = (payload: AdminDeviceDetailPayload) => {
  const parts = [payload.brand?.trim(), payload.model?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "N/A";
};

const maintenanceStatusChip = (status: string) => {
  if (status === "IN_PROGRESS") {
    return <StatusBadge status="in-progress" />;
  }
  if (status === "FINISHED") {
    return <StatusBadge status="completed" />;
  }

  return (
    <Chip
      label="Megszakítva"
      size="small"
      sx={{
        bgcolor: "rgba(190, 24, 93, 0.12)",
        color: appColors.destructive,
        fontWeight: 700,
        fontSize: 11,
        height: 24,
      }}
    />
  );
};

export default function DeviceDetailsPage() {
  const navigate = useNavigate();
  const { deviceId } = useParams<{ deviceId: string }>();
  const [payload, setPayload] = useState<AdminDeviceDetailPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!deviceId) {
        setPayload(null);
        setError("A berendezés azonosítója hiányzik.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/admin/devices/${deviceId}`, {
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(await readApiErrorMessage(response, "Nem sikerült betölteni a berendezés részleteit."));
        }

        const nextPayload = (await response.json()) as AdminDeviceDetailPayload;
        if (!cancelled) {
          setPayload(nextPayload);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Nem sikerült betölteni a berendezés részleteit.");
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
  }, [deviceId]);

  const summaryTitle = useMemo(() => {
    if (!payload) {
      return "Berendezés részletei";
    }

    return payload.barcode?.trim() || payload.source_device_code?.trim() || "Azonosító nélkül";
  }, [payload]);

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
            <IconButton onClick={() => navigate("/admin/devices")} aria-label="Vissza">
              <ArrowLeft size={18} />
            </IconButton>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>
              Berendezés részletei
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
        <Alert severity="info">A berendezés nem található.</Alert>
      </Layout>
    );
  }

  const kindLabel = payload.original_kind?.trim() || getDeviceKindLabel(payload.kind) || payload.kind;
  const KindIcon = getDeviceKindIcon(payload.kind);

  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3, animation: "slideUp 0.3s ease-out" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <IconButton onClick={() => navigate("/admin/devices")} aria-label="Vissza">
            <ArrowLeft size={18} />
          </IconButton>
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, pb: 2 }}>
              <Box sx={{ color: appColors.primary }}>
                <KindIcon size={36} />
              </Box>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {summaryTitle}
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5, flexWrap: "wrap" }}>
              <Chip label={kindLabel} size="small" sx={{ fontWeight: 700 }} />
              <Chip
                label={payload.is_maintainable ? "Karbantartható" : "Nem karbantartható"}
                size="small"
                sx={{
                  fontWeight: 700,
                  bgcolor: payload.is_maintainable ? appColors.success : "rgba(190, 24, 93, 0.12)",
                  color: payload.is_maintainable ? appColors.successForeground : appColors.destructive,
                }}
              />
            </Box>
          </Box>
        </Box>

        <Box
          sx={{
            display: "grid",
            gap: 3,
            gridTemplateColumns: { xs: "1fr", xl: "1.1fr 0.9fr" },
            alignItems: "start",
          }}
        >
          <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
              <CardHeader title="Berendezés adatai" titleTypographyProps={{ variant: "subtitle1", fontWeight: 700 }} />
              <CardContent>
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
                    gap: 0,
                  }}
                >
                  {[
                    { label: "Márka / Modell", value: formatBrandModel(payload), icon: Cpu },
                    { label: "Típus", value: kindLabel, icon: Blocks },
                    { label: "Épület és helyszín", value: `${payload.building_name}\n${payload.building_address}\n${formatLocation(payload)}`, icon: MapPin },
                    { label: "Vonalkód", value: renderText(payload.barcode), icon: Barcode },
                    { label: "Azonosító", value: renderText(payload.source_device_code), icon: Hash },
                    { label: "Gyári szám", value: renderText(payload.serial_number), icon: PencilRuler },
                  ].map(({ label, value, icon: Icon }) => (
                    <Box key={label} sx={{ p: 1.5, borderRadius: 2 }}>
                      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5 }}>
                        <Box
                          sx={{
                            width: 32,
                            height: 32,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            bgcolor: "rgba(0, 0, 0, 0.08)",
                            borderRadius: 2,
                            mt: 0.25,
                          }}
                        >
                          <Icon size={18} color={appColors.primary} />
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            {label}
                          </Typography>
                          {value.split("\n").map((line) => (
                            <Typography key={`${label}-${line}`} variant="subtitle2" sx={{ fontWeight: 600 }}>
                              {line}
                            </Typography>
                          ))}
                        </Box>
                      </Box>
                    </Box>
                  ))}
                </Box>
              </CardContent>
            </Card>

            {payload.additional_info?.trim() ? (
              <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
                <CardHeader title="Megjegyzés" titleTypographyProps={{ variant: "subtitle1", fontWeight: 700 }} />
                <CardContent>
                  <Typography variant="body2" color="text.secondary">
                    {payload.additional_info}
                  </Typography>
                </CardContent>
              </Card>
            ) : null}

            <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
              <CardHeader
                disableTypography
                title={
                  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      Karbantartási előzmények
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {payload.maintenances.length} esemény
                    </Typography>
                  </Box>
                }
              />
              <CardContent sx={{ pt: 0 }}>
                {payload.maintenances.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    Ehhez a berendezéshez még nem készült karbantartási bejegyzés.
                  </Typography>
                ) : (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Állapot</TableCell>
                          <TableCell>Karbantartó</TableCell>
                          <TableCell>Kezdete</TableCell>
                          <TableCell>Befejezése</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {payload.maintenances.map((maintenance) => (
                          <TableRow
                            key={maintenance.maintenance_id}
                            hover
                            onClick={() => navigate(`/admin/maintenances/${maintenance.maintenance_id}`)}
                            sx={{ cursor: "pointer" }}
                          >
                            <TableCell>{maintenanceStatusChip(maintenance.status)}</TableCell>
                            <TableCell>{maintenance.maintainer_user_name}</TableCell>
                            <TableCell>{formatDateTime(new Date(maintenance.started_at))}</TableCell>
                            <TableCell>
                              {maintenance.finished_at
                                ? formatDateTime(new Date(maintenance.finished_at))
                                : maintenance.aborted_at
                                  ? formatDateTime(new Date(maintenance.aborted_at))
                                  : "-"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </CardContent>
            </Card>
          </Box>

          <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
              <CardHeader title="Statisztikák" titleTypographyProps={{ variant: "subtitle1", fontWeight: 700 }} />
              <CardContent>
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", xl: "1fr" },
                    gap: 1.5,
                  }}
                >
                  {[
                    { label: "Vonalkódok száma", value: String(payload.barcode_count) },
                    { label: "Karbantartások száma", value: String(payload.maintenance_count) },
                    { label: "Létrehozva", value: formatDateTime(new Date(payload.created_at)) },
                    { label: "Utolsó karbantartás", value: payload.latest_maintenance_at ? formatDateTime(new Date(payload.latest_maintenance_at)) : "N/A" },
                  ].map((item) => (
                    <Box
                      key={item.label}
                      sx={{
                        p: 1.5,
                        borderRadius: 2,
                        bgcolor: "rgba(0, 0, 0, 0.04)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 0.5,
                      }}
                    >
                      <Typography variant="caption" color="text.secondary">
                        {item.label}
                      </Typography>
                      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                        {item.value}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </CardContent>
            </Card>

            {payload.device_photo_url ? (
              <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
                <CardHeader title="Eszközfotó" titleTypographyProps={{ variant: "subtitle1", fontWeight: 700 }} />
                <CardContent>
                  <Box
                    component="img"
                    src={payload.device_photo_url}
                    alt={summaryTitle}
                    sx={{
                      width: "100%",
                      display: "block",
                      borderRadius: 2,
                      border: "1px solid rgba(15, 23, 42, 0.08)",
                    }}
                  />
                </CardContent>
              </Card>
            ) : (
              <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
                <CardHeader title="Eszközfotó" titleTypographyProps={{ variant: "subtitle1", fontWeight: 700 }} />
                <CardContent>
                  <Box
                    sx={{
                      minHeight: 220,
                      display: "grid",
                      placeItems: "center",
                      borderRadius: 2,
                      border: "1px dashed rgba(15, 23, 42, 0.16)",
                      bgcolor: "rgba(15, 23, 42, 0.03)",
                      color: "text.secondary",
                      gap: 1,
                    }}
                  >
                    <ImageIcon size={28} />
                    <Typography variant="body2">Ehhez a berendezéshez nincs feltöltött fotó.</Typography>
                  </Box>
                </CardContent>
              </Card>
            )}
          </Box>
        </Box>
      </Box>
    </Layout>
  );
}
