import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import { getDeviceKindLabel } from "@noma/shared";
import {
  ArrowLeft,
  ChevronDown,
  Download,
  HardHat,
  MapPinned,
  MessageCircleMore,
  MessageCircleWarning,
  Users,
  Wrench,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { toast } from "@/lib/toast";
import { appColors } from "@/theme";

type ShiftParticipantRow = {
  user_id: string;
  full_name: string;
  role: string;
  status: string;
  invited_at: string;
  accepted_at: string | null;
  cache_ready_at: string | null;
  close_confirmed_at: string | null;
};

type ShiftMaintenanceRow = {
  maintenance_id: string;
  barcode: string | null;
  kind: string;
  brand: string | null;
  model: string | null;
  floor: string | null;
  wing: string | null;
  room: string | null;
  location_description: string | null;
  maintainer_user_name: string;
  started_at: string;
  ended_at: string | null;
  followup_service_required: boolean;
  has_notes: boolean;
};

type ShiftDetailsPayload = {
  shift_id: string;
  status: string;
  building_name: string;
  building_address: string;
  shift_lead_name: string;
  created_at: string;
  started_at: string | null;
  closed_at: string | null;
  finished_at: string | null;
  avg_maintenance_pace_minutes: number | null;
  participants_count: number;
  total_maintenances: number;
  total_followup_service: number;
  report_url: string | null;
  report_ready: boolean;
  participants: ShiftParticipantRow[];
  maintenances: ShiftMaintenanceRow[];
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

const roleLabel: Record<string, string> = {
  ADMIN: "Adminisztrátor",
  LEAD_TECHNICIAN: "Műszakvezető",
  TECHNICIAN: "Technikus",
  VIEWER: "Megtekintő",
  PARTNER: "Partner",
};

const statusLabel: Record<string, string> = {
  INVITED: "Meghívva",
  ACCEPTED: "Elfogadva",
  CACHE_READY: "Cache kész",
  CLOSE_CONFIRMED: "Lezárás megerősítve",
  DECLINED: "Elutasítva",
  INVITING: "Meghívás alatt",
  READY_TO_START: "Indításra kész",
  IN_PROGRESS: "Folyamatban",
  CLOSE_REQUESTED: "Lezárás kérve",
  READY_TO_COMMIT: "Commitre kész",
  COMMITTED: "Lezárt",
  CANCELLED: "Megszakítva",
};

const formatDateTime = (value: string | null) => {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("hu-HU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
};

const formatTimeRange = (startedAt: string, endedAt: string | null) =>
  `${formatDateTime(startedAt)} - ${formatDateTime(endedAt)}`;

const formatAverageMinutes = (value: number | null) => {
  if (value == null) {
    return "-";
  }
  return `${Math.round(value)} perc`;
};

const formatBrandType = (row: ShiftMaintenanceRow) => {
  const parts = [row.brand?.trim(), row.model?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "-";
};

const formatLocation = (row: ShiftMaintenanceRow) => {
  const parts = [
    row.floor?.trim(),
    row.wing?.trim(),
    row.room?.trim(),
    row.location_description?.trim(),
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" / ") : "-";
};

export default function ShiftDetailsPage() {
  const navigate = useNavigate();
  const { shiftId } = useParams<{ shiftId: string }>();
  const [payload, setPayload] = useState<ShiftDetailsPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [participantsExpanded, setParticipantsExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!shiftId) {
        setPayload(null);
        setError("A műszak azonosítója hiányzik.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/admin/shifts/${shiftId}`, {
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(await readApiErrorMessage(response, "Nem sikerült betölteni a műszak részleteit."));
        }
        const nextPayload = (await response.json()) as ShiftDetailsPayload;
        if (!cancelled) {
          setPayload(nextPayload);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Nem sikerült betölteni a műszak részleteit.");
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
  }, [shiftId]);

  const handleDownloadReport = () => {
    if (!payload) {
      return;
    }

    if (payload.report_url) {
      window.open(payload.report_url, "_blank", "noopener,noreferrer");
      return;
    }

    if (payload.status === "COMMITTED") {
      toast.info("A munkalap letöltése még nincs implementálva.");
    }
  };

  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <IconButton onClick={() => navigate("/admin/shifts")} aria-label="Vissza">
            <ArrowLeft size={18} />
          </IconButton>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            Műszak részletei
          </Typography>
        </Box>

        {error ? <Alert severity="error">{error}</Alert> : null}

        {isLoading ? (
          <Box sx={{ py: 8, display: "grid", placeItems: "center" }}>
            <CircularProgress color="secondary" />
          </Box>
        ) : !payload ? (
          <Alert severity="info">A műszak nem található.</Alert>
        ) : (
          <>
            <Card sx={{ border: `1px solid ${appColors.border}`, boxShadow: "0 12px 28px rgba(15, 23, 42, 0.08)" }}>
              <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: { xs: "column", md: "row" },
                    alignItems: { xs: "stretch", md: "flex-start" },
                    justifyContent: "space-between",
                    gap: 2,
                  }}
                >
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
                    <Typography variant="h5" sx={{ fontWeight: 800 }}>
                      {payload.building_name}
                    </Typography>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "text.secondary" }}>
                      <MapPinned size={16} />
                      <Typography variant="body2">{payload.building_address}</Typography>
                    </Box>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "text.secondary" }}>
                      <HardHat size={16} />
                      <Typography variant="body2">{payload.shift_lead_name}</Typography>
                    </Box>
                  </Box>
                  <Button
                    variant="outlined"
                    startIcon={<Download size={16} />}
                    onClick={handleDownloadReport}
                    disabled={payload.status !== "COMMITTED" && (!payload.report_ready || !payload.report_url)}
                    sx={{ alignSelf: { xs: "stretch", md: "flex-start" } }}
                  >
                    Munkalap letöltése
                  </Button>
                </Box>

                <Divider />

                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
                    gap: 1.5,
                  }}
                >
                  <Box>
                    <Typography variant="caption" color="text.secondary">Státusz</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{statusLabel[payload.status] ?? payload.status}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Létrehozva</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{formatDateTime(payload.created_at)}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Indítva</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{formatDateTime(payload.started_at)}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Lezárva</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{formatDateTime(payload.closed_at)}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Befejezve</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{formatDateTime(payload.finished_at)}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Átl. karbantartási tempó</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{formatAverageMinutes(payload.avg_maintenance_pace_minutes)}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">További szervíz</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{payload.total_followup_service}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Karbantartások száma</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{payload.total_maintenances}</Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>

            <Accordion
              expanded={participantsExpanded}
              onChange={(_, expanded) => setParticipantsExpanded(expanded)}
              sx={{
                border: `1px solid ${appColors.border}`,
                borderRadius: "12px !important",
                boxShadow: "0 8px 20px rgba(15, 23, 42, 0.06)",
                "&::before": { display: "none" },
              }}
            >
              <AccordionSummary
                expandIcon={<ChevronDown size={18} />}
                aria-controls="participants-content"
                id="participants-header"
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Users size={18} />
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>
                    Résztvevők
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    ({payload.participants.length})
                  </Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails sx={{ pt: 0 }}>
                <TableContainer sx={{ border: `1px solid ${appColors.border}`, borderRadius: 3, overflow: "hidden" }}>
                  <Table>
                    <TableHead>
                      <TableRow sx={{ bgcolor: "rgba(15, 23, 42, 0.04)" }}>
                        <TableCell>Név</TableCell>
                        <TableCell>Szerepkör</TableCell>
                        <TableCell>Státusz</TableCell>
                        <TableCell>Meghívva</TableCell>
                        <TableCell>Elfogadva</TableCell>
                        <TableCell>Cache kész</TableCell>
                        <TableCell>Lezárás megerősítve</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {payload.participants.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} sx={{ py: 4, textAlign: "center", color: "text.secondary" }}>
                            Nincs résztvevő adat.
                          </TableCell>
                        </TableRow>
                      ) : (
                        payload.participants.map((participant) => (
                          <TableRow key={participant.user_id}>
                            <TableCell>{participant.full_name}</TableCell>
                            <TableCell>{roleLabel[participant.role] ?? participant.role}</TableCell>
                            <TableCell>{statusLabel[participant.status] ?? participant.status}</TableCell>
                            <TableCell>{formatDateTime(participant.invited_at)}</TableCell>
                            <TableCell>{formatDateTime(participant.accepted_at)}</TableCell>
                            <TableCell>{formatDateTime(participant.cache_ready_at)}</TableCell>
                            <TableCell>{formatDateTime(participant.close_confirmed_at)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </AccordionDetails>
            </Accordion>

            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Wrench size={18} />
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  Karbantartások
                </Typography>
              </Box>
              <TableContainer sx={{ border: `1px solid ${appColors.border}`, borderRadius: 3, overflow: "hidden" }}>
                <Table>
                  <TableHead>
                    <TableRow sx={{ bgcolor: "rgba(15, 23, 42, 0.04)" }}>
                      <TableCell>Vonalkód</TableCell>
                      <TableCell>Típus</TableCell>
                      <TableCell>Márka + típus</TableCell>
                      <TableCell>Helyszín</TableCell>
                      <TableCell>Karbantartó</TableCell>
                      <TableCell>Karbantartás</TableCell>
                      <TableCell align="center" sx={{ width: 56 }} />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {payload.maintenances.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} sx={{ py: 4, textAlign: "center", color: "text.secondary" }}>
                          Nincs karbantartási adat.
                        </TableCell>
                      </TableRow>
                    ) : (
                      payload.maintenances.map((maintenance) => (
                        <TableRow
                          key={maintenance.maintenance_id}
                          hover
                          onClick={() =>
                            navigate(
                              `/admin/shifts/${payload.shift_id}/maintenances/${maintenance.maintenance_id}`,
                            )
                          }
                          sx={{ cursor: "pointer" }}
                        >
                          <TableCell>{maintenance.barcode ?? "-"}</TableCell>
                          <TableCell>{getDeviceKindLabel(maintenance.kind) ?? maintenance.kind}</TableCell>
                          <TableCell>{formatBrandType(maintenance)}</TableCell>
                          <TableCell>{formatLocation(maintenance)}</TableCell>
                          <TableCell>{maintenance.maintainer_user_name}</TableCell>
                          <TableCell>{formatTimeRange(maintenance.started_at, maintenance.ended_at)}</TableCell>
                          <TableCell align="center">
                            <Box
                              component="span"
                              sx={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 0.75,
                                minHeight: 18,
                              }}
                            >
                              {maintenance.has_notes ? (
                                <Tooltip title="Megjegyzés van rögzítve">
                                  <Box
                                    component="span"
                                    sx={{
                                      display: "inline-flex",
                                      color: "text.secondary",
                                      verticalAlign: "middle",
                                    }}
                                  >
                                    <MessageCircleMore size={18} />
                                  </Box>
                                </Tooltip>
                              ) : null}
                              {maintenance.followup_service_required ? (
                                <Tooltip title="További szervíz szükséges">
                                  <Box
                                    component="span"
                                    sx={{
                                      display: "inline-flex",
                                      color: "error.main",
                                      verticalAlign: "middle",
                                    }}
                                  >
                                    <MessageCircleWarning size={18} />
                                  </Box>
                                </Tooltip>
                              ) : null}
                            </Box>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          </>
        )}
      </Box>
    </Layout>
  );
}
