import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { Building2, Clock3, HardHat, TriangleAlert, Users, Wrench } from "lucide-react";
import { Layout } from "@/components/Layout";
import { appColors } from "@/theme";

type AdminLiveShift = {
  shift_id: string;
  status: string;
  building_name: string;
  lead_user_name: string;
  created_at: string;
  started_at: string | null;
  closed_at: string | null;
  participants_ready_count: number;
  participants_invited_count: number;
  participants_count: number;
  malfunctioning_count: number;
  maintenances_synced: number;
};

type AdminPastShift = {
  shift_id: string;
  status: string;
  date: string;
  started_at: string | null;
  finished_at: string | null;
  building_name: string;
  lead_user_name: string;
  participants_count: number;
  malfunctioning_count: number;
  maintenances_count: number;
  avg_maintenance_minutes: number | null;
  report_ready: boolean;
};

type AdminShiftsPayload = {
  live: AdminLiveShift[];
  past: AdminPastShift[];
};

const readApiErrorMessage = async (response: Response, fallback: string) => {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // Ignore JSON parsing errors and fall back to the provided message.
  }
  return fallback;
};

const statusLabel: Record<string, string> = {
  INVITING: "Meghívás alatt",
  READY_TO_START: "Indításra kész",
  IN_PROGRESS: "Folyamatban",
  CLOSE_REQUESTED: "Lezárás folyamatban",
  READY_TO_COMMIT: "Aláírásra vár",
  COMMITTED: "Lezárt",
  CANCELLED: "Megszakítva",
};

const statusColor = (status: string) => {
  switch (status) {
    case "READY_TO_START":
    case "READY_TO_COMMIT":
      return { bgcolor: "rgba(239, 164, 35, 0.16)", color: appColors.accentForeground };
    case "IN_PROGRESS":
      return { bgcolor: "rgba(26, 127, 55, 0.14)", color: appColors.successForeground };
    case "CLOSE_REQUESTED":
      return { bgcolor: "rgba(15, 23, 42, 0.08)", color: appColors.primary };
    case "CANCELLED":
      return { bgcolor: "rgba(190, 24, 93, 0.12)", color: appColors.destructive };
    default:
      return { bgcolor: "rgba(15, 23, 42, 0.08)", color: appColors.primary };
  }
};

const formatDate = (value: string | null) => {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("hu-HU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
};

const formatTime = (value: string | null) => {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("hu-HU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
};

const formatTimeRange = (startedAt: string | null, finishedAt: string | null) => {
  if (!startedAt) {
    return "-";
  }
  return `${formatTime(startedAt)} - ${formatTime(finishedAt)}`;
};

const formatAverageMinutes = (value: number | null) => {
  if (value == null) {
    return "-";
  }
  return `${Math.round(value)} perc`;
};

const LiveShiftCard = ({
  shift,
  onOpen,
}: {
  shift: AdminLiveShift;
  onOpen: (shiftId: string) => void;
}) => {
  const badgeColors = statusColor(shift.status);
  const isPreStart = shift.status === "INVITING" || shift.status === "READY_TO_START";

  return (
    <Card
      sx={{
        height: "100%",
        border: `1px solid ${appColors.border}`,
        boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
      }}
    >
      <CardActionArea onClick={() => onOpen(shift.shift_id)} sx={{ height: "100%" }}>
        <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%" }}>
          <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                {shift.building_name}
              </Typography>
              <Box sx={{ mt: 0.75, display: "flex", alignItems: "center", gap: 0.75, color: "text.secondary" }}>
                <HardHat size={16} />
                <Typography variant="body2">{shift.lead_user_name}</Typography>
              </Box>
            </Box>
            <Chip
              label={statusLabel[shift.status] ?? shift.status}
              size="small"
              sx={{ ...badgeColors, fontWeight: 700 }}
            />
          </Box>

          <Box sx={{ display: "grid", gap: 1.25 }}>
            {isPreStart ? (
              <>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "text.secondary" }}>
                  <Clock3 size={16} />
                  <Typography variant="body2">Létrehozva: {formatDate(shift.created_at)} {formatTime(shift.created_at)}</Typography>
                </Box>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "text.secondary" }}>
                  <Users size={16} />
                  <Typography variant="body2">
                    Résztvevők: {shift.participants_ready_count}/{shift.participants_invited_count}
                  </Typography>
                </Box>
              </>
            ) : (
              <>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "text.secondary" }}>
                  <Clock3 size={16} />
                  <Typography variant="body2">Indult: {formatTime(shift.started_at)}</Typography>
                </Box>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "text.secondary" }}>
                  <Users size={16} />
                  <Typography variant="body2">Résztvevők száma: {shift.participants_count}</Typography>
                </Box>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "text.secondary" }}>
                  <TriangleAlert size={16} />
                  <Typography variant="body2">Hibásnak jelölt: {shift.malfunctioning_count}</Typography>
                </Box>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "text.secondary" }}>
                  <Wrench size={16} />
                  <Typography variant="body2">Szinkronizált karbantartások: {shift.maintenances_synced}</Typography>
                </Box>
                {shift.status === "READY_TO_COMMIT" ? (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "text.secondary" }}>
                    <Clock3 size={16} />
                    <Typography variant="body2">Lezárva: {formatTime(shift.closed_at)}</Typography>
                  </Box>
                ) : null}
              </>
            )}
          </Box>
        </CardContent>
      </CardActionArea>
    </Card>
  );
};

export default function AdminShiftsPage() {
  const navigate = useNavigate();
  const [payload, setPayload] = useState<AdminShiftsPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/admin/shifts", {
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(await readApiErrorMessage(response, "Nem sikerült betölteni a műszakokat."));
        }
        const nextPayload = (await response.json()) as AdminShiftsPayload;
        if (!cancelled) {
          setPayload(nextPayload);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Nem sikerült betölteni a műszakokat.");
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
  }, []);

  const openShift = (shiftId: string) => {
    navigate(`/admin/shifts/${shiftId}`);
  };

  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            Műszakok
          </Typography>
        </Box>

        {error ? <Alert severity="error">{error}</Alert> : null}

        {isLoading ? (
          <Box sx={{ py: 8, display: "grid", placeItems: "center" }}>
            <CircularProgress color="secondary" />
          </Box>
        ) : (
          <>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                Élő műszakok
              </Typography>
              {!payload || payload.live.length === 0 ? (
                <Alert severity="info">Jelenleg nincs aktív vagy előkészítés alatt álló műszak.</Alert>
              ) : (
                <Grid container spacing={2}>
                  {payload.live.map((shift) => (
                    <Grid key={shift.shift_id} item xs={12} md={6} xl={4}>
                      <LiveShiftCard shift={shift} onOpen={openShift} />
                    </Grid>
                  ))}
                </Grid>
              )}
            </Box>

            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                Korábbi műszakok
              </Typography>
              <TableContainer
                sx={{
                  border: `1px solid ${appColors.border}`,
                  borderRadius: 3,
                  maxWidth: "100%",
                  overflowX: "auto",
                  overflowY: "hidden",
                  bgcolor: appColors.card,
                }}
              >
                <Table sx={{ minWidth: 900 }}>
                  <TableHead>
                    <TableRow sx={{ bgcolor: "rgba(15, 23, 42, 0.04)" }}>
                      <TableCell>Dátum</TableCell>
                      <TableCell>Indítás-Befejezés</TableCell>
                      <TableCell>Épület</TableCell>
                      <TableCell>Műszakvezető</TableCell>
                      <TableCell>Résztvevők</TableCell>
                      <TableCell>Szervíz</TableCell>
                      <TableCell>Karbantartások</TableCell>
                      <TableCell>Átl. tempó</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {!payload || payload.past.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} sx={{ py: 5, textAlign: "center", color: "text.secondary" }}>
                          Nincs korábbi műszak.
                        </TableCell>
                      </TableRow>
                    ) : (
                      payload.past.map((shift) => (
                        <TableRow
                          key={shift.shift_id}
                          hover
                          onClick={() => openShift(shift.shift_id)}
                          sx={{ cursor: "pointer" }}
                        >
                          <TableCell>{formatDate(shift.date)}</TableCell>
                          <TableCell>{formatTimeRange(shift.started_at, shift.finished_at)}</TableCell>
                          <TableCell>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                              <Building2 size={16} />
                              <Typography variant="body2">{shift.building_name}</Typography>
                            </Box>
                          </TableCell>
                          <TableCell>{shift.lead_user_name}</TableCell>
                          <TableCell>{shift.participants_count}</TableCell>
                          <TableCell>{shift.malfunctioning_count}</TableCell>
                          <TableCell>{shift.maintenances_count}</TableCell>
                          <TableCell>{formatAverageMinutes(shift.avg_maintenance_minutes)}</TableCell>
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
