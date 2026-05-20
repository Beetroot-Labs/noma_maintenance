import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { Download, Plus } from "lucide-react";
import { getDeviceKindLabel } from "@noma/shared";
import { Layout } from "@/components/Layout";
import { formatDateTime } from "@/lib/date";
import { formatBrandModel, formatMoney, formatProposalLocation } from "@/lib/proposals";
import { appColors } from "@/theme";
import type { AdminProposalListRow } from "@/types/proposals";

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

const deviceLabel = (row: AdminProposalListRow) => {
  const kind = row.device_original_kind?.trim() || getDeviceKindLabel(row.device_kind) || row.device_kind;
  const brandModel = formatBrandModel(row.device_brand, row.device_model);

  return brandModel === "-" ? kind : `${kind} · ${brandModel}`;
};

const deviceIdentifier = (row: AdminProposalListRow) => row.device_barcode?.trim() || row.device_source_device_code?.trim() || "-";

export default function ProposalsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<AdminProposalListRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/admin/proposals", {
          credentials: "include",
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(await readApiErrorMessage(response, "Nem sikerült betölteni az ajánlatokat."));
        }

        const nextRows = (await response.json()) as AdminProposalListRow[];
        if (!cancelled) {
          setRows(nextRows);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Nem sikerült betölteni az ajánlatokat.");
          setRows([]);
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

  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: { xs: "stretch", sm: "center" },
            justifyContent: "space-between",
            gap: 2,
            flexDirection: { xs: "column", sm: "row" },
          }}
        >
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 800 }}>
              Ajánlatok
            </Typography>
          </Box>

          <Button
            variant="contained"
            startIcon={<Plus size={16} />}
            onClick={() => navigate("/admin/proposals/new")}
            sx={{ alignSelf: { xs: "stretch", sm: "auto" } }}
          >
            Új ajánlat
          </Button>
        </Box>

        {error ? <Alert severity="error">{error}</Alert> : null}

        {isLoading ? (
          <Box sx={{ py: 8, display: "grid", placeItems: "center" }}>
            <CircularProgress color="secondary" />
          </Box>
        ) : rows.length === 0 ? (
          <Alert severity="info">Még nincs létrehozott ajánlat.</Alert>
        ) : (
          <Paper
            sx={{
              borderRadius: 3,
              overflow: "hidden",
              border: "1px solid",
              borderColor: "divider",
              background: "background.paper",
            }}
          >
            <TableContainer sx={{ maxWidth: "100%", overflowX: "auto" }}>
              <Table sx={{ minWidth: 1100 }} size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: "rgba(15, 23, 42, 0.04)" }}>
                    <TableCell>Dátum</TableCell>
                    <TableCell>Berendezés</TableCell>
                    <TableCell>Helyszín</TableCell>
                    <TableCell align="right">Nettó összeg</TableCell>
                    <TableCell align="right">Tételek</TableCell>
                    <TableCell>Készítette</TableCell>
                    <TableCell align="right">PDF</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.proposal_id}
                      hover
                      onClick={() => navigate(`/admin/proposals/${row.proposal_id}`)}
                      sx={{ cursor: "pointer" }}
                    >
                      <TableCell>{formatDateTime(new Date(row.created_at))}</TableCell>
                      <TableCell>
                        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            {deviceIdentifier(row)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {deviceLabel(row)}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            {row.building_name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatProposalLocation(row)}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {formatMoney(row.net_price, row.currency)}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Chip label={`${row.line_count} tétel`} size="small" sx={{ fontWeight: 700 }} />
                      </TableCell>
                      <TableCell>{row.created_by_name ?? "-"}</TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="text"
                          startIcon={<Download size={16} />}
                          onClick={(event) => {
                            event.stopPropagation();
                            window.open(`/api/admin/proposals/${row.proposal_id}/pdf`, "_blank", "noopener,noreferrer");
                          }}
                          sx={{ color: appColors.primary }}
                        >
                          Letöltés
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        )}
      </Box>
    </Layout>
  );
}
