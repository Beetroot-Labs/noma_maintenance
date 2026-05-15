import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  InputAdornment,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import { Building2, ChevronLeft, Plus, Search, Trash2, X } from "lucide-react";
import { getDeviceKindLabel } from "@noma/shared";
import { Layout } from "@/components/Layout";
import { formatDateTime } from "@/lib/date";
import {
  formatBrandModel,
  formatDeviceIdentifier,
  formatMoney,
  formatProposalLocation,
  parseDecimalInput,
} from "@/lib/proposals";
import { createUuid } from "@/lib/uuid";
import { toast } from "@/lib/toast";
import { appColors } from "@/theme";
import type {
  AdminBuilding,
  AdminProposalDeviceRow,
  CreateAdminProposalRequest,
  ProposalLineDraft,
} from "@/types/proposals";

type AdminDevicesResponse = {
  selected_building_name: string;
  rows: AdminProposalDeviceRow[];
  total_count: number;
  page: number;
  page_size: number;
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

const createLine = (): ProposalLineDraft => ({
  id: createUuid(),
  item: "",
  quantity: "",
  uom: "db",
  net_unit_price: "",
});

const DEFAULT_PROPOSAL_NOTE =
  "Az ajánlat tartalmazza a szükséges anyagok beszerzését, helyszínre szállítását illetve a bontást.";

const lineIsComplete = (line: ProposalLineDraft) =>
  Boolean(line.item.trim()) && Boolean(line.quantity.trim()) && Boolean(line.uom.trim()) && Boolean(line.net_unit_price.trim());

const lineIsValid = (line: ProposalLineDraft) => {
  if (!lineIsComplete(line)) {
    return false;
  }

  const quantity = Number(parseDecimalInput(line.quantity));
  const netUnitPrice = Number(parseDecimalInput(line.net_unit_price));
  return Number.isFinite(quantity) && quantity > 0 && Number.isFinite(netUnitPrice) && netUnitPrice >= 0;
};

const calculateTotal = (lines: ProposalLineDraft[]) =>
  lines.reduce((sum, line) => {
    const quantity = Number(parseDecimalInput(line.quantity));
    const netUnitPrice = Number(parseDecimalInput(line.net_unit_price));
    if (!Number.isFinite(quantity) || !Number.isFinite(netUnitPrice)) {
      return sum;
    }
    return sum + quantity * netUnitPrice;
  }, 0);

const deviceLabel = (device: AdminProposalDeviceRow) => {
  const kind = device.original_kind?.trim() || getDeviceKindLabel(device.kind) || device.kind;
  const brandModel = formatBrandModel(device.brand, device.model);

  return brandModel === "-" ? kind : `${kind} · ${brandModel}`;
};

const matchesDeviceQuery = (device: AdminProposalDeviceRow, query: string) => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  const values = [
    formatDeviceIdentifier(device),
    deviceLabel(device),
    formatProposalLocation(device),
    device.building_name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return values.includes(normalized);
};

export default function ProposalNewPage() {
  const navigate = useNavigate();
  const [buildings, setBuildings] = useState<AdminBuilding[]>([]);
  const [selectedBuilding, setSelectedBuilding] = useState<AdminBuilding | null>(null);
  const [devices, setDevices] = useState<AdminProposalDeviceRow[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<AdminProposalDeviceRow | null>(null);
  const [devicePickerOpen, setDevicePickerOpen] = useState(false);
  const [devicePickerStep, setDevicePickerStep] = useState<"buildings" | "devices">("buildings");
  const [deviceFilter, setDeviceFilter] = useState("");
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [isLoadingBuildings, setIsLoadingBuildings] = useState(false);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [lines, setLines] = useState<ProposalLineDraft[]>([createLine()]);
  const [externalIssueNumber, setExternalIssueNumber] = useState("");
  const [note, setNote] = useState(DEFAULT_PROPOSAL_NOTE);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const total = useMemo(() => calculateTotal(lines), [lines]);
  const totalDisplay = useMemo(() => formatMoney(total.toString(), "Ft"), [total]);
  const canSubmit = selectedDevice !== null && lines.length > 0 && lines.every(lineIsValid);

  const loadBuildings = async () => {
    setIsLoadingBuildings(true);
    setPickerError(null);

    try {
      const response = await fetch("/api/admin/buildings", {
        credentials: "include",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, "Nem sikerült betölteni az épületeket."));
      }

      const nextBuildings = (await response.json()) as AdminBuilding[];
      setBuildings(nextBuildings);
    } catch (err) {
      setPickerError(err instanceof Error ? err.message : "Nem sikerült betölteni az épületeket.");
    } finally {
      setIsLoadingBuildings(false);
    }
  };

  const loadDevices = async (buildingId: string) => {
    setIsLoadingDevices(true);
    setPickerError(null);

    try {
      const params = new URLSearchParams({ buildingId });
      const response = await fetch(`/api/admin/devices?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, "Nem sikerült betölteni a berendezéseket."));
      }

      const payload = (await response.json()) as AdminDevicesResponse;
      setDevices(payload.rows);
    } catch (err) {
      setPickerError(err instanceof Error ? err.message : "Nem sikerült betölteni a berendezéseket.");
      setDevices([]);
    } finally {
      setIsLoadingDevices(false);
    }
  };

  useEffect(() => {
    if (!devicePickerOpen) {
      return;
    }

    if (buildings.length === 0) {
      void loadBuildings();
    }

    if (selectedBuilding) {
      setDevicePickerStep("devices");
      void loadDevices(selectedBuilding.id);
    } else {
      setDevicePickerStep("buildings");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devicePickerOpen]);

  const openDevicePicker = () => {
    setPickerError(null);
    setDevicePickerOpen(true);
    setDeviceFilter("");
  };

  const closeDevicePicker = () => {
    setDevicePickerOpen(false);
    setPickerError(null);
    setDeviceFilter("");
  };

  const handleChooseBuilding = (building: AdminBuilding) => {
    setSelectedBuilding(building);
    setDevicePickerStep("devices");
    setDeviceFilter("");
    void loadDevices(building.id);
  };

  const handleChooseDevice = (device: AdminProposalDeviceRow) => {
    setSelectedDevice(device);
    closeDevicePicker();
  };

  const handleAddLine = () => {
    setLines((current) => [...current, createLine()]);
  };

  const handleRemoveLine = (lineId: string) => {
    setLines((current) => (current.length === 1 ? [createLine()] : current.filter((line) => line.id !== lineId)));
  };

  const handleLineChange = (lineId: string, key: keyof ProposalLineDraft, value: string) => {
    setLines((current) => current.map((line) => (line.id === lineId ? { ...line, [key]: value } : line)));
  };

  const handleSubmit = async () => {
    if (!selectedDevice || !canSubmit || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    const request: CreateAdminProposalRequest = {
      device_id: selectedDevice.device_id,
      note: note.trim(),
      external_issue_number: externalIssueNumber.trim(),
      lines: lines.map((line) => ({
        item: line.item.trim(),
        quantity: parseDecimalInput(line.quantity),
        uom: line.uom.trim(),
        net_unit_price: parseDecimalInput(line.net_unit_price),
      })),
    };

    try {
      const response = await fetch("/api/admin/proposals", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, "Nem sikerült létrehozni az ajánlatot."));
      }

      const created = (await response.json()) as { proposal_id?: string };
      if (!created.proposal_id) {
        throw new Error("Nem sikerült létrehozni az ajánlatot.");
      }

      toast.success("Az ajánlat sikeresen létrejött.");
      navigate(`/admin/proposals/${created.proposal_id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Nem sikerült létrehozni az ajánlatot.";
      setSubmitError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredDevices = useMemo(
    () => devices.filter((device) => matchesDeviceQuery(device, deviceFilter)),
    [deviceFilter, devices],
  );

  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <IconButton onClick={() => navigate("/admin/proposals")} aria-label="Vissza">
            <ChevronLeft size={18} />
          </IconButton>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            Új ajánlat
          </Typography>
        </Box>

        <Card sx={{ border: `1px solid ${appColors.border}`, boxShadow: "0 10px 24px rgba(31, 50, 58, 0.08)" }}>
          <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
            {submitError ? <Alert severity="error">{submitError}</Alert> : null}

            <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, gap: 2, alignItems: "stretch" }}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 700, mb: 1 }}>
                  Berendezés
                </Typography>
                {selectedDevice ? (
                  <Paper sx={{ p: 2, borderRadius: 2, border: `1px solid ${appColors.border}` }}>
                    <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2, alignItems: "flex-start" }}>
                      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 0 }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                          {formatDeviceIdentifier(selectedDevice)}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {deviceLabel(selectedDevice)}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {formatProposalLocation(selectedDevice)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Utolsó karbantartás: {selectedDevice.latest_maintenance_at ? formatDateTime(new Date(selectedDevice.latest_maintenance_at)) : "-"}
                        </Typography>
                      </Box>
                      <Button variant="outlined" onClick={openDevicePicker}>
                        Módosítás
                      </Button>
                    </Box>
                  </Paper>
                ) : (
                  <Button
                    fullWidth
                    variant="outlined"
                    startIcon={<Building2 size={16} />}
                    onClick={openDevicePicker}
                    sx={{ justifyContent: "flex-start", textTransform: "none", py: 1.5 }}
                  >
                    Berendezés kiválasztása
                  </Button>
                )}
              </Box>

            </Box>

            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <Typography variant="body2" color="text.secondary">
                A nettó árakból automatikusan számítjuk az összesítést.
              </Typography>
              <Button variant="outlined" startIcon={<Plus size={16} />} onClick={handleAddLine} sx={{ alignSelf: "flex-start" }}>
                Sor hozzáadása
              </Button>
            </Box>
          </CardContent>
        </Card>

        <Card sx={{ border: `1px solid ${appColors.border}`, boxShadow: "0 10px 24px rgba(31, 50, 58, 0.08)" }}>
          <CardHeader title="Tételek" titleTypographyProps={{ variant: "subtitle1", fontWeight: 700 }} />
          <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {lines.map((line, index) => (
              <Box
                key={line.id}
                sx={{
                  display: "grid",
                  gap: 1.25,
                  gridTemplateColumns: { xs: "1fr", md: "minmax(0, 2fr) 0.7fr 0.6fr 0.9fr auto" },
                  alignItems: { xs: "stretch", md: "start" },
                  p: 1.5,
                  borderRadius: 2,
                  bgcolor: index % 2 === 0 ? "rgba(15, 23, 42, 0.02)" : "transparent",
                }}
              >
                <TextField
                  label="Tétel"
                  value={line.item}
                  onChange={(event) => handleLineChange(line.id, "item", event.target.value)}
                  multiline
                  minRows={2}
                  fullWidth
                />
                <TextField
                  label="Mennyiség"
                  value={line.quantity}
                  onChange={(event) => handleLineChange(line.id, "quantity", event.target.value)}
                  inputMode="decimal"
                  fullWidth
                />
                <TextField
                  label="Egység"
                  value={line.uom}
                  onChange={(event) => handleLineChange(line.id, "uom", event.target.value)}
                  fullWidth
                />
                <TextField
                  label="Nettó egységár"
                  value={line.net_unit_price}
                  onChange={(event) => handleLineChange(line.id, "net_unit_price", event.target.value)}
                  inputMode="decimal"
                  fullWidth
                />
                <Box sx={{ display: "flex", alignItems: { xs: "flex-start", md: "center" }, pt: { xs: 0, md: 1 } }}>
                  <IconButton
                    aria-label="Sor törlése"
                    onClick={() => handleRemoveLine(line.id)}
                    color="error"
                    sx={{ alignSelf: { xs: "flex-start", md: "center" } }}
                  >
                    <Trash2 size={16} />
                  </IconButton>
                </Box>
              </Box>
            ))}
          </CardContent>
        </Card>

        <Card sx={{ border: `1px solid ${appColors.border}`, boxShadow: "0 10px 24px rgba(31, 50, 58, 0.08)" }}>
          <CardContent
            sx={{
              display: "flex",
              flexDirection: { xs: "column", md: "row" },
              gap: 2,
              alignItems: "stretch",
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <TextField
                label="Igénylési szám"
                value={externalIssueNumber}
                onChange={(event) => setExternalIssueNumber(event.target.value)}
                fullWidth
              />
              <TextField
                label="Megjegyzés"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                fullWidth
                multiline
                minRows={5}
              />
            </Box>
            <Box
              sx={{
                width: { xs: "100%", md: 280 },
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: 2,
              }}
            >
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Nettó összesen
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  {totalDisplay}
                </Typography>
              </Box>
              <Button
                variant="contained"
                size="large"
                onClick={() => void handleSubmit()}
                disabled={!canSubmit || isSubmitting}
                sx={{ alignSelf: { xs: "stretch", md: "flex-start" } }}
              >
                {isSubmitting ? "Mentés..." : "Ajánlat létrehozása"}
              </Button>
            </Box>
          </CardContent>
        </Card>
      </Box>

      <Dialog
        open={devicePickerOpen}
        onClose={closeDevicePicker}
        fullWidth
        maxWidth="md"
        PaperProps={{ sx: { borderRadius: 3 } }}
      >
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, justifyContent: "space-between" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Building2 size={18} />
            Berendezés kiválasztása
          </Box>
          <IconButton onClick={closeDevicePicker} aria-label="Bezárás">
            <X size={16} />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ px: 0, pb: 0 }}>
          {pickerError ? (
            <Box sx={{ px: 3, pb: 2 }}>
              <Alert severity="error">{pickerError}</Alert>
            </Box>
          ) : null}

          {devicePickerStep === "buildings" ? (
            isLoadingBuildings ? (
              <Box sx={{ py: 6, display: "grid", placeItems: "center" }}>
                <CircularProgress color="secondary" />
              </Box>
            ) : buildings.length === 0 ? (
              <Box sx={{ px: 3, pb: 3 }}>
                <Alert severity="info">Ehhez a tenanthez még nincs elérhető épület.</Alert>
              </Box>
            ) : (
              <List disablePadding>
                {buildings.map((building) => (
                  <ListItemButton key={building.id} onClick={() => handleChooseBuilding(building)}>
                    <ListItemText
                      primary={building.name}
                      secondary={building.address}
                      primaryTypographyProps={{ fontWeight: 700 }}
                    />
                  </ListItemButton>
                ))}
              </List>
            )
          ) : (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <Box sx={{ px: 3, display: "flex", flexDirection: "column", gap: 1 }}>
                <Button
                  variant="text"
                  startIcon={<ChevronLeft size={16} />}
                  onClick={() => setDevicePickerStep("buildings")}
                  sx={{ alignSelf: "flex-start", textTransform: "none" }}
                >
                  Másik épület
                </Button>
                <Typography variant="body2" color="text.secondary">
                  {selectedBuilding?.name} · {selectedBuilding?.address}
                </Typography>
                <TextField
                  value={deviceFilter}
                  onChange={(event) => setDeviceFilter(event.target.value)}
                  placeholder="Keresés vonalkód, azonosító, helyszín alapján"
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <Search size={16} color={appColors.muted} />
                      </InputAdornment>
                    ),
                  }}
                  fullWidth
                />
              </Box>

              {isLoadingDevices ? (
                <Box sx={{ py: 6, display: "grid", placeItems: "center" }}>
                  <CircularProgress color="secondary" />
                </Box>
              ) : filteredDevices.length === 0 ? (
                <Box sx={{ px: 3, pb: 3 }}>
                  <Alert severity="info">Nincs a keresésnek megfelelő berendezés.</Alert>
                </Box>
              ) : (
                <List disablePadding>
                  {filteredDevices.map((device) => (
                    <ListItemButton key={device.device_id} onClick={() => handleChooseDevice(device)}>
                      <ListItemText
                        primary={formatDeviceIdentifier(device)}
                        secondary={`${deviceLabel(device)} · ${formatProposalLocation(device)}`}
                        primaryTypographyProps={{ fontWeight: 700 }}
                        secondaryTypographyProps={{ sx: { whiteSpace: "normal" } }}
                      />
                    </ListItemButton>
                  ))}
                </List>
              )}
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
