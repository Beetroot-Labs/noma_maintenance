import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
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
import { ArrowLeft, Download, Edit3 } from "lucide-react";
import { getDeviceKindLabel } from "@noma/shared";
import { Layout } from "@/components/Layout";
import { formatDateTime } from "@/lib/date";
import { formatBrandModel, formatMoney, formatProposalLocation, formatQuantity } from "@/lib/proposals";
import { appColors } from "@/theme";
import type { AdminProposalDetailPayload } from "@/types/proposals";

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

const deviceLabel = (payload: AdminProposalDetailPayload) => {
  const kind = payload.device_original_kind?.trim() || getDeviceKindLabel(payload.device_kind) || payload.device_kind;
  const brandModel = formatBrandModel(payload.device_brand, payload.device_model);

  return brandModel === "-" ? kind : `${kind} · ${brandModel}`;
};

const deviceIdentifier = (payload: AdminProposalDetailPayload) =>
  payload.device_barcode?.trim() || payload.device_source_device_code?.trim() || "-";

export default function ProposalDetailsPage() {
  const navigate = useNavigate();
  const { proposalId } = useParams<{ proposalId: string }>();
  const [payload, setPayload] = useState<AdminProposalDetailPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!proposalId) {
        setPayload(null);
        setError("Az ajánlat azonosítója hiányzik.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/admin/proposals/${proposalId}`, {
          credentials: "include",
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(await readApiErrorMessage(response, "Nem sikerült betölteni az ajánlat részleteit."));
        }

        const nextPayload = (await response.json()) as AdminProposalDetailPayload;
        if (!cancelled) {
          setPayload(nextPayload);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Nem sikerült betölteni az ajánlat részleteit.");
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
  }, [proposalId]);

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
            <IconButton onClick={() => navigate("/admin/proposals")} aria-label="Vissza">
              <ArrowLeft size={18} />
            </IconButton>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>
              Ajánlat részletei
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
        <Alert severity="info">Az ajánlat nem található.</Alert>
      </Layout>
    );
  }

  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3, animation: "slideUp 0.3s ease-out" }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <IconButton onClick={() => navigate("/admin/proposals")} aria-label="Vissza">
              <ArrowLeft size={18} />
            </IconButton>
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 800 }}>
                Ajánlat részletei
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {payload.proposal_id}
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            <Button
              variant="outlined"
              startIcon={<Edit3 size={16} />}
              onClick={() => navigate(`/admin/proposals/${payload.proposal_id}/edit`)}
            >
              Szerkesztés
            </Button>
            <Button
              variant="contained"
              startIcon={<Download size={16} />}
              onClick={() => window.open(`/api/admin/proposals/${payload.proposal_id}/pdf`, "_blank", "noopener,noreferrer")}
            >
              PDF letöltése
            </Button>
          </Box>
        </Box>

        <Card sx={{ border: `1px solid ${appColors.border}`, boxShadow: "0 10px 24px rgba(31, 50, 58, 0.08)" }}>
          <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
            <Box
              sx={{
                display: "flex",
                flexDirection: { xs: "column", md: "row" },
                justifyContent: "space-between",
                gap: 2,
              }}
            >
              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  {deviceIdentifier(payload)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {deviceLabel(payload)}
                </Typography>
                <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", pt: 0.5 }}>
                  <Chip label={payload.currency} sx={{ fontWeight: 700 }} />
                  <Chip label={`${payload.line_count} sor`} sx={{ fontWeight: 700 }} />
                </Box>
              </Box>

              <Box sx={{ display: "flex", flexDirection: "column", alignItems: { xs: "flex-start", md: "flex-end" }, gap: 0.75 }}>
                <Typography variant="body2" color="text.secondary">
                  Létrehozta: <strong>{payload.created_by_name ?? "-"}</strong>
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  E-mail: <strong>{payload.created_by_email ?? "-"}</strong>
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Dátum: <strong>{formatDateTime(new Date(payload.created_at))}</strong>
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 800, color: appColors.primary }}>
                  {formatMoney(payload.net_price, payload.currency)}
                </Typography>
              </Box>
            </Box>

            <Box
              sx={{
                display: "grid",
                gap: 1.5,
                gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
              }}
            >
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Épület
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {payload.building_name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {payload.building_address}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Helyszín
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {formatProposalLocation(payload)}
                </Typography>
              </Box>
            </Box>
          </CardContent>
        </Card>

        <TableContainer sx={{ borderRadius: 3, border: `1px solid ${appColors.border}`, overflow: "hidden" }}>
          <Table size="small" sx={{ minWidth: 1000 }}>
            <TableHead>
              <TableRow sx={{ bgcolor: "rgba(15, 23, 42, 0.04)" }}>
                <TableCell>Sorszám</TableCell>
                <TableCell>Tétel</TableCell>
                <TableCell align="right">Mennyiség</TableCell>
                <TableCell>Egység</TableCell>
                <TableCell align="right">Nettó egységár</TableCell>
                <TableCell align="right">Nettó érték</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {payload.lines.map((line) => (
                <TableRow key={line.proposal_line_id} hover>
                  <TableCell>{line.position}</TableCell>
                  <TableCell>{line.item}</TableCell>
                  <TableCell align="right">{formatQuantity(line.quantity)}</TableCell>
                  <TableCell>{line.uom}</TableCell>
                  <TableCell align="right">{formatMoney(line.net_unit_price, payload.currency)}</TableCell>
                  <TableCell align="right">{formatMoney(line.line_total, payload.currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        <Card sx={{ border: `1px solid ${appColors.border}`, boxShadow: "0 10px 24px rgba(31, 50, 58, 0.08)" }}>
          <CardHeader title="Összesítés" titleTypographyProps={{ variant: "subtitle1", fontWeight: 700 }} />
          <CardContent>
            <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2, alignItems: "center" }}>
              <Typography variant="body2" color="text.secondary">
                Nettó végösszeg
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                {formatMoney(payload.net_price, payload.currency)}
              </Typography>
            </Box>
          </CardContent>
        </Card>
      </Box>
    </Layout>
  );
}
