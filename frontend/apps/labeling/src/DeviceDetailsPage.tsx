import {
  ArrowBackIosNew,
  Apartment,
  CategoryOutlined,
  InfoOutlined,
  Inventory2Outlined,
  LocationOnOutlined,
  Height,
  SensorDoor,
  Business,
  MoreVert,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Dialog,
  DialogContent,
  DialogTitle,
  Fab,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { Barcode, Camera, Flashlight, FlashlightOff, ImagePlus, MessageCircleMore, Repeat, ScanBarcode, Trash2, TriangleAlert, X } from "lucide-react";
import { deviceKindLabels, getDeviceKindLabel, useAuth, useCode128Scanner, validateNomaBarcode } from "@noma/shared";
import { ChangeEvent, MouseEvent, ReactNode, SyntheticEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import LoginPage from "./LoginPage";
import { FilterableDeviceTable } from "./components/FilterableDeviceTable";
import { LabelingAppBar } from "./components/LabelingAppBar";
import {
  BuildingCachePayload,
  CachedDeviceListItem,
  cacheBuildingData,
  assignCachedDeviceBarcode,
  CachedDeviceDetails,
  deleteCachedDevicePhoto,
  EditableDeviceDetails,
  getCachedDeviceDetails,
  getCachedDeviceListItems,
  getSelectedCachedBuilding,
  replaceCachedDevicePhoto,
  syncPendingBarcodeAssignments,
  updateCachedDeviceDetails,
} from "./lib/offlineCache";
import { appColors } from "./theme";

type DeviceDetailsPageProps = {
  googleClientId: string;
};

type EditableFieldKey = Exclude<keyof EditableDeviceDetails, "isMaintainable">;
const locationFieldKeys: EditableFieldKey[] = ["floor", "wing", "room", "locationDescription"];

type DetailRowProps = {
  icon: ReactNode;
  label: string;
  value: string;
  valueColor?: string;
  valueAdornment?: ReactNode;
  helperText?: string | null;
  onClick?: () => void;
};

const editableFieldLabels: Record<EditableFieldKey, string> = {
  floor: "Emelet",
  wing: "Szárny",
  room: "Helyiség",
  locationDescription: "Hely leírása",
  kind: "Eszköz típusa",
  brand: "Márka",
  model: "Modell",
  serialNumber: "Gyári szám",
  sourceDeviceCode: "Eszköz azonosító",
  additionalInfo: "Megjegyzés",
};

function DetailRow({ icon, label, value, valueColor, valueAdornment, helperText, onClick }: DetailRowProps) {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="flex-start"
      onClick={onClick}
      sx={onClick ? { cursor: "pointer", borderRadius: "5px", "&:hover": { bgcolor: "action.hover" }, p: 0.5, m: -0.5 } : undefined}
    >
      <Box sx={{ color: "secondary.main", mt: "2px" }}>{icon}</Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
          <Typography sx={{ color: valueColor ?? "text.primary" }}>{value}</Typography>
          {valueAdornment}
        </Stack>
        {helperText ? (
          <Typography variant="caption" color="error.main">
            {helperText}
          </Typography>
        ) : null}
      </Box>
    </Stack>
  );
}

const formatBarcodeHistoryTimestamp = (value: string | null, fallback = "Nincs"): string => {
  if (!value) {
    return fallback;
  }

  const raw = value.trim();
  const postgresTimestampMatch = raw.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?([+-]\d{2})(?::?(\d{2}))?$/,
  );

  let parsed: Date;
  if (postgresTimestampMatch) {
    const [, datePart, timePart, fractionPart, timezoneHours, timezoneMinutes] =
      postgresTimestampMatch;
    const milliseconds = (fractionPart ?? "").slice(0, 3).padEnd(3, "0");
    const isoTimestamp = `${datePart}T${timePart}.${milliseconds}${timezoneHours}:${timezoneMinutes ?? "00"}`;
    parsed = new Date(isoTimestamp);
  } else {
    const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
    parsed = new Date(normalized);
  }

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("hu-HU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(parsed);
};

const readApiErrorMessage = async (response: Response, fallback: string) => {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // Ignore malformed error payloads.
  }
  return fallback;
};

const createMutationId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export function DeviceDetailsPage({ googleClientId }: DeviceDetailsPageProps) {
  const accentFabSx = {
    backgroundColor: appColors.accent,
    color: appColors.accentIcon,
    "&:hover": {
      backgroundColor: "#BE9A54",
    },
  } as const;

  const { user, clearUser, isHydrated } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [buildingName, setBuildingName] = useState<string | null>(null);
  const [device, setDevice] = useState<CachedDeviceDetails | null>(null);
  const [deviceRows, setDeviceRows] = useState<CachedDeviceListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [cachedPhotoUrl, setCachedPhotoUrl] = useState<string | null>(null);
  const [photoDialogOpen, setPhotoDialogOpen] = useState(false);
  const [barcodeDialogOpen, setBarcodeDialogOpen] = useState(false);
  const [actionsMenuAnchorEl, setActionsMenuAnchorEl] = useState<HTMLElement | null>(null);
  const [barcodeCorrectionDialogOpen, setBarcodeCorrectionDialogOpen] = useState(false);
  const [selectedCorrectionDeviceId, setSelectedCorrectionDeviceId] = useState<string | null>(null);
  const [barcodeCorrectionSuccessTargetDeviceId, setBarcodeCorrectionSuccessTargetDeviceId] =
    useState<string | null>(null);
  const [isCorrectingBarcode, setIsCorrectingBarcode] = useState(false);
  const [isUpdatingPhoto, setIsUpdatingPhoto] = useState(false);
  const [editingField, setEditingField] = useState<EditableFieldKey | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [isSavingField, setIsSavingField] = useState(false);
  const [isSavingMaintainable, setIsSavingMaintainable] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const barcodeScannerContainerRef = useRef<HTMLDivElement | null>(null);
  const activeObjectUrlRef = useRef<string | null>(null);

  const {
    isStarting: isAssigningBarcode,
    cameraError: barcodeCameraError,
    setCameraError: setBarcodeCameraError,
    flashlightSupported,
    flashlightEnabled,
    start: startBarcodeScanner,
    stop: stopBarcodeScanner,
    toggleFlashlight,
  } = useCode128Scanner({
    containerRef: barcodeScannerContainerRef,
    onDetected: async (scannedCode) => {
      if (!barcodeDialogOpen || !id) {
        return { status: "ignore" };
      }

      const validation = validateNomaBarcode(scannedCode);
      if (validation.error) {
        console.warn("Barcode validation error:", validation.error, "Scanned barcode:", scannedCode);
        return { status: "failure", errorMessage: validation.error };
      }
      const identifier = validation.identifier;
      if (!identifier) {
        return { status: "ignore" };
      }

      try {
        await assignCachedDeviceBarcode(id, identifier);
        await syncPendingBarcodeAssignments();
        await loadDeviceDetails(id);
        setBarcodeDialogOpen(false);
        return { status: "success" };
      } catch (error) {
        return {
          status: "failure",
          errorMessage:
            error instanceof Error
              ? error.message
              : "Nem sikerült elmenteni a beolvasott vonalkódot.",
        };
      }
    },
  });

  const loadDeviceDetails = async (deviceId: string) => {
    const [selectedBuilding, cachedDevice, cachedDeviceRows] = await Promise.all([
      getSelectedCachedBuilding(),
      getCachedDeviceDetails(deviceId),
      getCachedDeviceListItems(),
    ]);

    setBuildingName(selectedBuilding?.name ?? null);
    setDevice(cachedDevice);
    setDeviceRows(cachedDeviceRows);
  };

  useEffect(() => {
    if (!user || !id) {
      setDevice(null);
      setDeviceRows([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      try {
        await loadDeviceDetails(id);
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
  }, [id, user]);

  useEffect(() => {
    if (!device?.cachedPhotoBlob) {
      if (activeObjectUrlRef.current) {
        URL.revokeObjectURL(activeObjectUrlRef.current);
        activeObjectUrlRef.current = null;
      }
      setCachedPhotoUrl(device?.devicePhotoUrl ?? null);
      return;
    }

    const objectUrl = URL.createObjectURL(device.cachedPhotoBlob);
    const previousObjectUrl = activeObjectUrlRef.current;
    activeObjectUrlRef.current = objectUrl;
    setCachedPhotoUrl(objectUrl);

    if (previousObjectUrl) {
      window.setTimeout(() => {
        URL.revokeObjectURL(previousObjectUrl);
      }, 1000);
    }
  }, [device]);

  useEffect(
    () => () => {
      if (activeObjectUrlRef.current) {
        URL.revokeObjectURL(activeObjectUrlRef.current);
        activeObjectUrlRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (!barcodeDialogOpen) {
      stopBarcodeScanner();
      setBarcodeCameraError(null);
    }

    return () => {
      stopBarcodeScanner();
    };
  }, [barcodeDialogOpen, setBarcodeCameraError, stopBarcodeScanner]);

  const getEditableFieldCurrentValue = (field: EditableFieldKey): string => {
    if (!device) {
      return "";
    }
    switch (field) {
      case "floor":
        return device.floor ?? "";
      case "wing":
        return device.wing ?? "";
      case "room":
        return device.room ?? "";
      case "locationDescription":
        return device.locationDescription ?? "";
      case "kind":
        return device.kind;
      case "brand":
        return device.brand ?? "";
      case "model":
        return device.model ?? "";
      case "serialNumber":
        return device.serialNumber ?? "";
      case "sourceDeviceCode":
        return device.sourceDeviceCode ?? "";
      case "additionalInfo":
        return device.additionalInfo ?? "";
      default:
        return "";
    }
  };

  const handleOpenFieldEditor = (field: EditableFieldKey) => {
    if (locationFieldKeys.includes(field)) {
      return;
    }
    setEditingField(field);
    setEditingValue(getEditableFieldCurrentValue(field));
  };

  const handleSaveField = async () => {
    if (!id || !editingField) {
      return;
    }
    if (locationFieldKeys.includes(editingField)) {
      setEditingField(null);
      setEditingValue("");
      return;
    }

    const partial: Partial<EditableDeviceDetails> = {
      [editingField]: editingField === "kind" ? editingValue.trim() : editingValue,
    };

    setIsSavingField(true);
    try {
      await updateCachedDeviceDetails(id, partial);
      await loadDeviceDetails(id);
      setEditingField(null);
      setEditingValue("");
    } catch (error) {
      setBarcodeCameraError(
        error instanceof Error
          ? error.message
          : "Nem sikerült frissíteni az eszköz adatait.",
      );
    } finally {
      setIsSavingField(false);
    }
  };

  const handleDeletePhoto = async () => {
    if (!id || !window.confirm("Biztosan törölni akarod az eszköz képét?")) {
      return;
    }

    setIsUpdatingPhoto(true);
    setPhotoDialogOpen(false);

    try {
      await deleteCachedDevicePhoto(id);
      await loadDeviceDetails(id);
    } finally {
      setIsUpdatingPhoto(false);
    }
  };

  const handleToggleMaintainable = async (checked: boolean) => {
    if (!id) {
      return;
    }

    setIsSavingMaintainable(true);
    try {
      await updateCachedDeviceDetails(id, { isMaintainable: checked });
      await loadDeviceDetails(id);
    } catch (error) {
      setBarcodeCameraError(
        error instanceof Error
          ? error.message
          : "Nem sikerült frissíteni a karbantarthatósági jelölést.",
      );
    } finally {
      setIsSavingMaintainable(false);
    }
  };

  const handleOpenPhotoPicker = () => {
    uploadInputRef.current?.click();
  };

  const handleAssignBarcode = () => {
    setBarcodeDialogOpen(true);
  };

  const handlePhotoSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || !id) {
      return;
    }

    setIsUpdatingPhoto(true);

    try {
      await replaceCachedDevicePhoto(id, file);
      await loadDeviceDetails(id);
    } finally {
      setIsUpdatingPhoto(false);
    }
  };

  const refreshSelectedBuildingCache = async () => {
    const selectedBuilding = await getSelectedCachedBuilding();
    if (!selectedBuilding) {
      return;
    }

    const response = await fetch(`/api/labeling/buildings/${selectedBuilding.id}/cache`, {
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error("Nem sikerült frissíteni az offline adatokat.");
    }

    const payload = (await response.json()) as BuildingCachePayload;
    await cacheBuildingData(payload, selectedBuilding.id);
  };

  const handleSyncStatusClick = async () => {
    if (!id) {
      return;
    }

    await refreshSelectedBuildingCache();
    await loadDeviceDetails(id);
  };

  const handleOpenActionsMenu = (event: MouseEvent<HTMLElement>) => {
    setActionsMenuAnchorEl(event.currentTarget);
  };

  const handleCloseActionsMenu = () => {
    setActionsMenuAnchorEl(null);
  };

  const handleOpenBarcodeCorrectionDialog = () => {
    setSelectedCorrectionDeviceId(null);
    setBarcodeCorrectionDialogOpen(true);
  };

  const handleStartBarcodeCorrection = () => {
    handleCloseActionsMenu();
    handleOpenBarcodeCorrectionDialog();
  };

  const handleCloseBarcodeCorrectionDialog = () => {
    if (isCorrectingBarcode) {
      return;
    }
    setBarcodeCorrectionDialogOpen(false);
    setSelectedCorrectionDeviceId(null);
  };

  const handleSubmitBarcodeCorrection = async () => {
    if (!id || !selectedCorrectionDeviceId) {
      return;
    }

    const targetDeviceId = selectedCorrectionDeviceId;

    setIsCorrectingBarcode(true);
    try {
      const response = await fetch(`/api/labeling/devices/${id}/barcode-correction`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Mutation-Id": createMutationId(),
        },
        credentials: "include",
        body: JSON.stringify({ targetDeviceId }),
      });

      if (!response.ok) {
        throw new Error(
          await readApiErrorMessage(response, "Nem sikerült korrigálni a vonalkód-hozzárendelést."),
        );
      }

      await refreshSelectedBuildingCache();
      await loadDeviceDetails(id);
      setBarcodeCorrectionDialogOpen(false);
      setSelectedCorrectionDeviceId(null);
      setBarcodeCorrectionSuccessTargetDeviceId(targetDeviceId);
    } catch (error) {
      setBarcodeCameraError(
        error instanceof Error
          ? error.message
          : "Nem sikerült korrigálni a vonalkód-hozzárendelést.",
      );
    } finally {
      setIsCorrectingBarcode(false);
    }
  };

  const handleCloseBarcodeCorrectionSuccessSnackbar = (
    _: Event | SyntheticEvent,
    reason?: string,
  ) => {
    if (reason === "clickaway") {
      return;
    }
    setBarcodeCorrectionSuccessTargetDeviceId(null);
  };

  const handleOpenCorrectedTargetDevice = () => {
    if (!barcodeCorrectionSuccessTargetDeviceId) {
      return;
    }

    const targetDeviceId = barcodeCorrectionSuccessTargetDeviceId;
    setBarcodeCorrectionSuccessTargetDeviceId(null);
    navigate(`/devices/${targetDeviceId}`);
  };

  const correctionCandidateRows = useMemo(() => {
    if (!device) {
      return [];
    }

    return deviceRows.filter(
      (row) =>
        row.id !== device.id
        && (row.barcodeCount === 0 || row.barcodeCount === 1 || row.maintenanceWorkCount === 0),
    );
  }, [device, deviceRows]);

  const selectedCorrectionDevice = useMemo(
    () => correctionCandidateRows.find((row) => row.id === selectedCorrectionDeviceId) ?? null,
    [correctionCandidateRows, selectedCorrectionDeviceId],
  );

  if (!isHydrated) {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", px: 2 }}>
        <Typography variant="h2">Betöltés...</Typography>
      </Box>
    );
  }

  if (!user) {
    return <LoginPage googleClientId={googleClientId} />;
  }

  const barcodeHasSyncError = device?.codeSyncState === "FAILED" && Boolean(device.code);
  const shouldShowBarcodeFab =
    device ? device.code == null || device.codeSyncState === "FAILED" : false;
  const currentBarcodeCount =
    device ? Math.max(device.barcodeCount, device.code ? 1 : 0) : 0;
  const shouldShowMislabelAction = Boolean(device?.code);
  const shouldShowCorrectionInfo =
    currentBarcodeCount === 1 || (device?.maintenanceWorkCount ?? 0) === 0;

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <LabelingAppBar
        userName={user.name}
        userEmail={user.email}
        buildingName={buildingName}
        onBuildingClick={() => navigate(-1)}
        onSyncStatusClick={handleSyncStatusClick}
        onLogout={async () => {
          await clearUser();
        }}
      />

      <Box
        sx={{
          flex: 1,
          width: "min(100%, 920px)",
          mx: "auto",
          px: 2,
          py: 2,
          pb: "calc(24px + env(safe-area-inset-bottom))",
        }}
      >
        <Stack spacing={1.5}>
          <Box sx={{ px: 0.5 }}>
            <Button
              color="inherit"
              startIcon={<ArrowBackIosNew sx={{ fontSize: 16 }} />}
              onClick={() => navigate(-1)}
              sx={{ mb: 1, px: 0, justifyContent: "flex-start" }}
            >
              Vissza az eszközlistához
            </Button>
            <Typography variant="h2">Eszköz adatai</Typography>
          </Box>

          <Paper
            sx={{
              borderRadius: "5px",
              overflow: "hidden",
              border: "1px solid",
              borderColor: "divider",
              background: "background.paper",
            }}
          >
            {isLoading ? (
              <Box sx={{ px: 3, py: 5, display: "grid", placeItems: "center" }}>
                <CircularProgress color="secondary" />
              </Box>
            ) : !device ? (
              <Box sx={{ px: 3, py: 5 }}>
                <Typography variant="body1" sx={{ mb: 0.75 }}>
                  Az eszköz nem található a helyi gyorsítótárban.
                </Typography>
                <Typography color="text.secondary">
                  Térjen vissza a listához, és frissítse az épület offline adatait.
                </Typography>
              </Box>
            ) : (
              <Stack divider={<Divider flexItem />}>
                <Box sx={{ px: 3, py: 2.5 }}>
                  <Box
                    sx={{
                      display: "flex",
                      flexDirection: { xs: "column", sm: "row" },
                      justifyContent: "space-between",
                      alignItems: { xs: "flex-start", sm: "center" },
                      gap: 2,
                    }}
                  >
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Modell
                      </Typography>
                      <Typography variant="h2" sx={{ mt: 0.5 }}>
                        {device.model ?? "Nincs megadva"}
                      </Typography>
                      <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                        {device.brand ?? "Ismeretlen márka"}
                      </Typography>
                    </Box>

                    {shouldShowMislabelAction ? (
                      <IconButton
                        aria-label="Eszközműveletek"
                        onClick={handleOpenActionsMenu}
                        sx={{
                          border: "1px solid",
                          borderColor: "divider",
                          borderRadius: "5px",
                          alignSelf: { xs: "flex-end", sm: "center" },
                        }}
                      >
                        <MoreVert fontSize="small" />
                      </IconButton>
                    ) : null}
                  </Box>
                </Box>

                <Box sx={{ px: 3, py: 2.5 }}>
                  <Stack spacing={2}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      Helyadatok
                    </Typography>
                    <Box
                      sx={{
                        display: "grid",
                        gridTemplateColumns: {
                          xs: "1fr",
                          sm: "repeat(2, minmax(0, 1fr))",
                        },
                        gap: 2,
                      }}
                    >
                      <DetailRow
                        icon={<Apartment fontSize="small" />}
                        label="Épület"
                        value={buildingName ?? "Nincs megadva"}
                      />
                      <DetailRow
                        icon={<Height fontSize="small" />}
                        label="Emelet"
                        value={device.floor ?? "Nincs megadva"}
                      />
                      <DetailRow
                        icon={<Business fontSize="small" />}
                        label="Szárny"
                        value={device.wing ?? "Nincs megadva"}
                      />
                      <DetailRow
                        icon={<SensorDoor fontSize="small" />}
                        label="Helyiség"
                        value={device.room ?? "Nincs megadva"}
                      />
                      <Box sx={{ gridColumn: { xs: "auto", sm: "1 / -1" } }}>
                        <DetailRow
                          icon={<LocationOnOutlined fontSize="small" />}
                          label="Hely leírása"
                          value={device.locationDescription ?? "Nincs megadva"}
                        />
                      </Box>
                    </Box>
                  </Stack>
                </Box>

                <Box sx={{ px: 3, py: 2.5 }}>
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                      gap: 2.5,
                      alignItems: "start",
                    }}
                  >
                    <Stack spacing={2}>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        Eszközadatok
                      </Typography>
                      <DetailRow
                        icon={<Barcode fontSize="small" />}
                        label="Kód"
                        value={device.code ?? "Nincs hozzárendelt kód"}
                        valueColor={barcodeHasSyncError ? "error.main" : undefined}
                        valueAdornment={
                          barcodeHasSyncError ? (
                            <Box sx={{ color: "error.main", display: "inline-flex" }}>
                              <TriangleAlert size={16} aria-label="Vonalkód szinkronhiba" />
                            </Box>
                          ) : device.code != null ? (
                            <IconButton
                              size="small"
                              onClick={handleAssignBarcode}
                              aria-label="Vonalkód újraolvasása"
                              sx={{ p: 0.25 }}
                            >
                              <Repeat size={16} />
                            </IconButton>
                          ) : null
                        }
                        helperText={barcodeHasSyncError ? device.codeSyncError : null}
                      />
                      <DetailRow
                        icon={<CategoryOutlined fontSize="small" />}
                        label="Eszköz típusa"
                        value={getDeviceKindLabel(device.kind)}
                        onClick={() => handleOpenFieldEditor("kind")}
                      />
                      <Stack
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        justifyContent="space-between"
                      >
                        <DetailRow
                          icon={<InfoOutlined fontSize="small" />}
                          label="Karbantarthatóság"
                          value={
                            device.isMaintainable
                              ? "A berendezés karbantartható"
                              : "A berendezés nem karbantartható"
                          }
                          valueColor={!device.isMaintainable ? "error.main" : undefined}
                        />
                        <Switch
                          checked={device.isMaintainable}
                          disabled={isSavingMaintainable}
                          onChange={(_, checked) => {
                            void handleToggleMaintainable(checked);
                          }}
                          color="secondary"
                          inputProps={{ "aria-label": "Eszköz karbantartható kapcsoló" }}
                        />
                      </Stack>
                      <DetailRow
                        icon={<Inventory2Outlined fontSize="small" />}
                        label="Modell"
                        value={device.model ?? "Nincs megadva"}
                        onClick={() => handleOpenFieldEditor("model")}
                      />
                      <DetailRow
                        icon={<Inventory2Outlined fontSize="small" />}
                        label="Márka"
                        value={device.brand ?? "Nincs megadva"}
                        onClick={() => handleOpenFieldEditor("brand")}
                      />
                      <DetailRow
                        icon={<InfoOutlined fontSize="small" />}
                        label="Gyári szám"
                        value={device.serialNumber ?? "Nincs megadva"}
                        onClick={() => handleOpenFieldEditor("serialNumber")}
                      />
                      <DetailRow
                        icon={<InfoOutlined fontSize="small" />}
                        label="Eszközazonosító"
                        value={device.sourceDeviceCode ?? "Nincs megadva"}
                        onClick={() => handleOpenFieldEditor("sourceDeviceCode")}
                      />
                      <DetailRow
                        icon={<MessageCircleMore size={18} />}
                        label="Megjegyzés"
                        value={device.additionalInfo ?? "Nincs megadva"}
                        onClick={() => handleOpenFieldEditor("additionalInfo")}
                      />
                    </Stack>

                    <Box>
                      <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mb: 1.25 }}>
                        <IconButton
                          color="error"
                          disabled={isUpdatingPhoto || !cachedPhotoUrl}
                          onClick={() => void handleDeletePhoto()}
                          sx={{
                            border: "1px solid",
                            borderColor: "divider",
                            borderRadius: "5px",
                          }}
                        >
                          <Trash2 size={18} />
                        </IconButton>
                        <IconButton
                          color="secondary"
                          disabled={isUpdatingPhoto}
                          onClick={handleOpenPhotoPicker}
                          sx={{
                            border: "1px solid",
                            borderColor: "divider",
                            borderRadius: "5px",
                          }}
                        >
                          <Camera size={18} />
                        </IconButton>
                      </Stack>
                      {cachedPhotoUrl ? (
                        <Box
                          component="img"
                          src={cachedPhotoUrl}
                          alt="Eszköz"
                          onClick={() => setPhotoDialogOpen(true)}
                          sx={{
                            display: "block",
                            width: "100%",
                            height: "auto",
                            cursor: "zoom-in",
                            borderRadius: "5px",
                            border: "1px solid",
                            borderColor: "divider",
                            backgroundColor: "grey.100",
                            aspectRatio: "3 / 2",
                            objectFit: "cover",
                          }}
                        />
                      ) : (
                        <Box
                          sx={{
                            display: "grid",
                            placeItems: "center",
                            width: "100%",
                            minHeight: 180,
                            px: 2,
                            textAlign: "center",
                            borderRadius: "5px",
                            border: "1px solid",
                            borderColor: "divider",
                            backgroundColor: "grey.100",
                            color: "text.secondary",
                          }}
                        >
                          <Typography variant="body2">
                            Erről az eszközről nem található fénykép.
                          </Typography>
                        </Box>
                      )}
                      <input
                        ref={uploadInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        hidden
                        onChange={handlePhotoSelection}
                      />
                    </Box>
                  </Box>
                </Box>

                <Box sx={{ px: 3, py: 2.5 }}>
                  <Stack spacing={1.5}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      Vonalkód előzmények
                    </Typography>

                    {device.barcodeHistory.length === 0 ? (
                      <Typography color="text.secondary">
                        Ehhez az eszközhöz még nincs mentett vonalkód előzmény.
                      </Typography>
                    ) : (
                      <TableContainer
                        component={Paper}
                        variant="outlined"
                        sx={{ borderRadius: "5px", borderColor: "divider", boxShadow: "none" }}
                      >
                        <Table size="small" aria-label="Vonalkód előzmények táblázat">
                          <TableHead>
                            <TableRow>
                              <TableCell sx={{ fontWeight: 700 }}>Vonalkód</TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>Létrehozva</TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>Inaktiválva</TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>Létrehozta</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {device.barcodeHistory.map((entry, index) => (
                              <TableRow key={`${entry.code}-${entry.createdAt}-${index}`}>
                                <TableCell>{entry.code}</TableCell>
                                <TableCell>
                                  {formatBarcodeHistoryTimestamp(entry.createdAt)}
                                </TableCell>
                                <TableCell>
                                  {formatBarcodeHistoryTimestamp(entry.deactivatedAt, "Aktív")}
                                </TableCell>
                                <TableCell>{entry.createdBy ?? "Ismeretlen"}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    )}
                  </Stack>
                </Box>
              </Stack>
            )}
          </Paper>
        </Stack>
      </Box>

      <Menu
        anchorEl={actionsMenuAnchorEl}
        open={Boolean(actionsMenuAnchorEl)}
        onClose={handleCloseActionsMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        PaperProps={{ sx: { borderRadius: "5px", mt: 0.5, minWidth: 280 } }}
      >
        {shouldShowMislabelAction ? (
          <MenuItem onClick={handleStartBarcodeCorrection}>
            Tévesen felcímkézett berendezés
          </MenuItem>
        ) : null}
      </Menu>

      {device && (shouldShowBarcodeFab || !cachedPhotoUrl) && (
        <Stack
          spacing={1.25}
          sx={{
            position: "fixed",
            right: 32,
            bottom: "calc(32px + env(safe-area-inset-bottom))",
            zIndex: 1200,
          }}
        >
          {shouldShowBarcodeFab && (
            <Fab
              aria-label="Vonalkód hozzárendelése"
              onClick={handleAssignBarcode}
              sx={accentFabSx}
            >
              <ScanBarcode size={20} />
            </Fab>
          )}
          {!cachedPhotoUrl && (
            <Fab
              aria-label="Fénykép hozzáadása"
              onClick={handleOpenPhotoPicker}
              disabled={isUpdatingPhoto}
              sx={accentFabSx}
            >
              <ImagePlus size={20} />
            </Fab>
          )}
        </Stack>
      )}

      <Dialog
        open={Boolean(editingField)}
        onClose={() => {
          if (!isSavingField) {
            setEditingField(null);
            setEditingValue("");
          }
        }}
        fullWidth
        maxWidth="sm"
        PaperProps={{ sx: { borderRadius: "5px" } }}
      >
        <Box sx={{ px: 3, py: 2.5 }}>
          <Stack spacing={2}>
            <Typography variant="h2">
              {editingField ? `${editableFieldLabels[editingField]} szerkesztése` : "Mező szerkesztése"}
            </Typography>
            {editingField === "kind" ? (
              <TextField
                select
                fullWidth
                label={editableFieldLabels.kind}
                value={editingValue}
                onChange={(event) => setEditingValue(event.target.value)}
              >
                {Object.entries(deviceKindLabels).map(([value, label]) => (
                  <MenuItem key={value} value={value}>
                    {label}
                  </MenuItem>
                ))}
              </TextField>
            ) : (
              <TextField
                fullWidth
                multiline={editingField === "additionalInfo" || editingField === "locationDescription"}
                minRows={editingField === "additionalInfo" || editingField === "locationDescription" ? 3 : 1}
                label={editingField ? editableFieldLabels[editingField] : "Érték"}
                value={editingValue}
                onChange={(event) => setEditingValue(event.target.value)}
                autoFocus
              />
            )}
            <Stack direction="row" justifyContent="flex-end" spacing={1}>
              <Button
                onClick={() => {
                  setEditingField(null);
                  setEditingValue("");
                }}
                disabled={isSavingField}
              >
                Mégse
              </Button>
              <Button
                variant="contained"
                onClick={() => void handleSaveField()}
                disabled={isSavingField || (editingField === "kind" && !editingValue.trim())}
              >
                {isSavingField ? "Mentés..." : "Mentés"}
              </Button>
            </Stack>
          </Stack>
        </Box>
      </Dialog>

      <Dialog
        open={barcodeCorrectionDialogOpen}
        onClose={handleCloseBarcodeCorrectionDialog}
        fullWidth
        maxWidth="lg"
        PaperProps={{ sx: { borderRadius: "5px" } }}
      >
        <DialogTitle>Tévesen felcímkézett berendezés</DialogTitle>
        <DialogContent sx={{ pt: 1, pb: 3 }}>
          <Stack spacing={2}>
            <Typography color="text.secondary">
              Válaszd ki azt a berendezést, amelyhez a jelenlegi aktív vonalkód valójában tartozik.
            </Typography>

            {shouldShowCorrectionInfo ? (
              <Alert severity="info" variant="outlined">
                Ennél a berendezésnél csak egy vonalkód található vagy még nincs hozzá karbantartás.
                A korrekció emiatt főként a vonalkód hozzárendelést érinti.
              </Alert>
            ) : null}

            <FilterableDeviceTable
              rows={correctionCandidateRows}
              selectedDeviceId={selectedCorrectionDeviceId}
              onRowClick={(candidate) => setSelectedCorrectionDeviceId(candidate.id)}
              maxHeight="min(52vh, 480px)"
              loadingText="Eszközlista betöltése..."
              emptyRowsText="Nincs olyan berendezés, amely megfelel a korrekció feltételeinek."
              emptyFilteredRowsText="Nincs a megadott szűrésnek megfelelő célberendezés."
            />

            {selectedCorrectionDevice ? (
              <Typography variant="body2" color="text.secondary">
                Kiválasztott cél: {selectedCorrectionDevice.brand ?? "Ismeretlen márka"}{" "}
                {selectedCorrectionDevice.model ?? "ismeretlen modell"}
              </Typography>
            ) : null}

            <Stack direction="row" spacing={1.5} justifyContent="flex-end">
              <Button
                color="inherit"
                onClick={handleCloseBarcodeCorrectionDialog}
                disabled={isCorrectingBarcode}
              >
                Mégse
              </Button>
              <Button
                variant="contained"
                color="secondary"
                onClick={() => void handleSubmitBarcodeCorrection()}
                disabled={isCorrectingBarcode || !selectedCorrectionDevice}
              >
                {isCorrectingBarcode ? "Korrigálás..." : "Vonalkód korrigálása"}
              </Button>
            </Stack>
          </Stack>
        </DialogContent>
      </Dialog>

      <Dialog
        open={barcodeDialogOpen}
        onClose={() => {
          if (!isAssigningBarcode) {
            setBarcodeDialogOpen(false);
          }
        }}
        TransitionProps={{
          onEntered: () => {
            window.setTimeout(() => {
              startBarcodeScanner();
            }, 0);
          },
        }}
        fullScreen
        PaperProps={{
          sx: {
            borderRadius: 0,
            backgroundColor: "common.black",
          },
        }}
      >
        <Box
          sx={{
            position: "relative",
            width: "100%",
            height: "100dvh",
            overflow: "hidden",
            bgcolor: "common.black",
          }}
        >
          <Box
            ref={barcodeScannerContainerRef}
            sx={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              "& video": {
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                maxWidth: "100%",
                maxHeight: "100%",
                width: "auto",
                height: "auto",
              },
              "& canvas": {
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                maxWidth: "100%",
                maxHeight: "100%",
                width: "auto",
                height: "auto",
                pointerEvents: "none",
              },
            }}
          />

          <Box
            sx={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: { xs: "72%", sm: "60%" },
              height: { xs: "30%", sm: "28%" },
              transform: "translate(-50%, -50%)",
              border: "2px solid rgba(255,255,255,0.9)",
              borderRadius: "5px",
              boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.25)",
              pointerEvents: "none",
            }}
          />

          <Stack
            direction="row"
            sx={{
              position: "absolute",
              top: "max(12px, env(safe-area-inset-top))",
              left: 0,
              right: 0,
              px: 1.5,
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <IconButton
              onClick={() => setBarcodeDialogOpen(false)}
              sx={{
                color: "common.white",
                bgcolor: "rgba(0, 0, 0, 0.45)",
                "&:hover": { bgcolor: "rgba(0, 0, 0, 0.6)" },
              }}
              aria-label="Bezárás"
            >
              <X size={18} />
            </IconButton>
            <IconButton
              color="secondary"
              onClick={toggleFlashlight}
              disabled={!flashlightSupported || isAssigningBarcode}
              sx={{
                color: "common.white",
                bgcolor: "rgba(0, 0, 0, 0.45)",
                "&:hover": { bgcolor: "rgba(0, 0, 0, 0.6)" },
                "&.Mui-disabled": {
                  color: "rgba(255,255,255,0.45)",
                },
              }}
              aria-label="Zseblámpa"
            >
              {flashlightEnabled ? <FlashlightOff size={18} /> : <Flashlight size={18} />}
            </IconButton>
          </Stack>

          {isAssigningBarcode && !barcodeCameraError && (
            <Box
              sx={{
                position: "absolute",
                bottom: "max(20px, env(safe-area-inset-bottom))",
                left: "50%",
                transform: "translateX(-50%)",
                display: "flex",
                alignItems: "center",
                gap: 1.25,
                px: 1.5,
                py: 0.75,
                borderRadius: "5px",
                bgcolor: "rgba(0,0,0,0.55)",
                color: "common.white",
              }}
            >
              <CircularProgress size={18} sx={{ color: "common.white" }} />
              <Typography variant="body2" sx={{ color: "common.white" }}>
                Kamera indítása...
              </Typography>
            </Box>
          )}
        </Box>
      </Dialog>

      <Snackbar
        open={Boolean(barcodeCorrectionSuccessTargetDeviceId)}
        autoHideDuration={7000}
        onClose={handleCloseBarcodeCorrectionSuccessSnackbar}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity="success"
          variant="filled"
          sx={{ width: "100%", cursor: "pointer" }}
          onClick={handleOpenCorrectedTargetDevice}
          onClose={() => setBarcodeCorrectionSuccessTargetDeviceId(null)}
        >
          Eszközadatok sikeresen átmozgatva. Kattints ide a megtekintéshez
        </Alert>
      </Snackbar>

      <Snackbar
        open={Boolean(barcodeCameraError)}
        autoHideDuration={5000}
        onClose={(_, reason) => {
          if (reason === "clickaway") {
            return;
          }
          setBarcodeCameraError(null);
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={() => setBarcodeCameraError(null)}
          severity="error"
          variant="filled"
          sx={{ width: "100%" }}
        >
          {barcodeCameraError}
        </Alert>
      </Snackbar>

      <Dialog
        open={photoDialogOpen}
        onClose={() => setPhotoDialogOpen(false)}
        maxWidth={false}
        PaperProps={{
          sx: {
            width: "min(100vw - 24px, 1200px)",
            maxHeight: "min(100vh - 24px, 900px)",
            borderRadius: "5px",
            backgroundColor: "transparent",
            boxShadow: "none",
            overflow: "hidden",
          },
        }}
      >
        {cachedPhotoUrl && (
          <Box
            component="img"
            src={cachedPhotoUrl}
            alt="Eszköz teljes méretben"
            onClick={() => setPhotoDialogOpen(false)}
            sx={{
              display: "block",
              width: "100%",
              height: "100%",
              cursor: "zoom-out",
              objectFit: "contain",
              backgroundColor: "rgba(0, 0, 0, 0.92)",
            }}
          />
        )}
      </Dialog>
    </Box>
  );
}
