import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Card,
  CardContent,
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
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { useDemoUser } from "@/context/DemoUserContext";
import { useShift } from "@/context/ShiftContext";

type ShiftMaintenanceSummaryRow = {
  maintenance_id: string;
  maintainer_user_name: string;
  maintenance_status: string;
  started_at: string;
  finished_at: string | null;
  aborted_at: string | null;
  malfunction_description: string | null;
  note: string | null;
  device_id: string;
  device_code: string | null;
  device_kind: string;
  device_additional_info: string | null;
  device_brand: string | null;
  device_model: string | null;
  device_serial_number: string | null;
  source_device_code: string | null;
  building_name: string;
  building_address: string;
  floor: string | null;
  wing: string | null;
  room: string | null;
  location_description: string | null;
};

type ShiftMaintenanceSummaryPayload = {
  shift_id: string;
  shift_status: string;
  building_name: string;
  lead_user_id: string;
  lead_user_name: string;
  maintenances: ShiftMaintenanceSummaryRow[];
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

const formatLocation = (row: ShiftMaintenanceSummaryRow) => {
  const primary = [row.floor, row.wing, row.room].map((part) => part?.trim()).filter(Boolean).join(", ");
  const secondary = row.location_description?.trim();
  if (primary && secondary) {
    return `${primary} (${secondary})`;
  }
  if (primary) {
    return primary;
  }
  if (secondary) {
    return secondary;
  }
  return "-";
};

const readApiErrorMessage = async (response: Response, fallback: string) => {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // Ignore malformed payload.
  }
  return fallback;
};

export default function ShiftSummaryPage() {
  const navigate = useNavigate();
  const { user } = useDemoUser();
  const { currentShift, isLoading: isShiftLoading } = useShift();
  const [payload, setPayload] = useState<ShiftMaintenanceSummaryPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!currentShift?.id) {
        if (!cancelled) {
          setPayload(null);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/shifts/${currentShift.id}/maintenance-summary`, {
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(
            await readApiErrorMessage(response, "Nem sikerült betölteni a műszak összegzését."),
          );
        }
        const nextPayload = (await response.json()) as ShiftMaintenanceSummaryPayload;
        if (!cancelled) {
          setPayload(nextPayload);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Nem sikerült betölteni a műszak összegzését.");
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
  }, [currentShift?.id]);

  const isShiftLead = Boolean(user && payload && user.id === payload.lead_user_id);

  const rows = useMemo(() => payload?.maintenances ?? [], [payload]);

  if (isShiftLoading) {
    return (
      <Layout>
        <Box sx={{ py: 6, display: "grid", placeItems: "center" }}>
          <CircularProgress color="secondary" />
        </Box>
      </Layout>
    );
  }

  if (!currentShift) {
    return null;
  }

  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <IconButton onClick={() => navigate("/shift-details")} aria-label="Vissza">
            <ArrowLeft size={18} />
          </IconButton>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Műszak összegzése
          </Typography>
        </Box>

        {error ? <Alert severity="error">{error}</Alert> : null}

        {isLoading ? (
          <Box sx={{ py: 6, display: "grid", placeItems: "center" }}>
            <CircularProgress color="secondary" />
          </Box>
        ) : !payload ? (
          <Alert severity="info">Nem érhető el műszak összegzés.</Alert>
        ) : !isShiftLead ? (
          <Alert severity="error">Csak a műszakvezető láthatja ezt az oldalt.</Alert>
        ) : (
          <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
            <CardContent sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  {payload.building_name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Műszakvezető: {payload.lead_user_name}
                </Typography>
              </Box>

              <TableContainer sx={{ overflowX: "auto" }}>
                <Table size="small" sx={{ minWidth: 1400 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Karbantartó</TableCell>
                      <TableCell>Vonalkód</TableCell>
                      <TableCell>Eszköz ID</TableCell>
                      <TableCell>Típus</TableCell>
                      <TableCell>Márka</TableCell>
                      <TableCell>Modell</TableCell>
                      <TableCell>Gyári szám</TableCell>
                      <TableCell>Forráskód</TableCell>
                      <TableCell>További adat</TableCell>
                      <TableCell>Épület</TableCell>
                      <TableCell>Cím</TableCell>
                      <TableCell>Helyszín</TableCell>
                      <TableCell>Állapot</TableCell>
                      <TableCell>Kezdés</TableCell>
                      <TableCell>Befejezés</TableCell>
                      <TableCell>Megszakítás</TableCell>
                      <TableCell>Hiba leírás</TableCell>
                      <TableCell>Jegyzet</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.maintenance_id} hover>
                        <TableCell>{row.maintainer_user_name}</TableCell>
                        <TableCell>{row.device_code ?? "-"}</TableCell>
                        <TableCell>{row.device_id}</TableCell>
                        <TableCell>{row.device_kind}</TableCell>
                        <TableCell>{row.device_brand ?? "-"}</TableCell>
                        <TableCell>{row.device_model ?? "-"}</TableCell>
                        <TableCell>{row.device_serial_number ?? "-"}</TableCell>
                        <TableCell>{row.source_device_code ?? "-"}</TableCell>
                        <TableCell>{row.device_additional_info ?? "-"}</TableCell>
                        <TableCell>{row.building_name}</TableCell>
                        <TableCell>{row.building_address}</TableCell>
                        <TableCell>{formatLocation(row)}</TableCell>
                        <TableCell>{row.maintenance_status}</TableCell>
                        <TableCell>{formatDateTime(row.started_at)}</TableCell>
                        <TableCell>{formatDateTime(row.finished_at)}</TableCell>
                        <TableCell>{formatDateTime(row.aborted_at)}</TableCell>
                        <TableCell>{row.malfunction_description ?? "-"}</TableCell>
                        <TableCell>{row.note ?? "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>

              {rows.length === 0 ? (
                <Alert severity="info">Ehhez a műszakhoz még nincs szinkronizált karbantartás.</Alert>
              ) : null}
            </CardContent>
          </Card>
        )}
      </Box>
    </Layout>
  );
}
