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
} from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Dialog,
  Fab,
  IconButton,
  Paper,
  Snackbar,
  Stack,
  Typography,
} from "@mui/material";
import Quagga, { type QuaggaJSResultObject } from "@ericblade/quagga2";
import { Barcode, Camera, Flashlight, FlashlightOff, ImagePlus, ScanBarcode, Trash2, TriangleAlert, X } from "lucide-react";
import { getDeviceKindLabel, useAuth, validateNomaBarcode } from "@noma/shared";
import { ChangeEvent, ReactNode, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import LoginPage from "./LoginPage";
import { LabelingAppBar } from "./components/LabelingAppBar";
import {
  BuildingCachePayload,
  cacheBuildingData,
  assignCachedDeviceBarcode,
  CachedDeviceDetails,
  deleteCachedDevicePhoto,
  getCachedDeviceDetails,
  getSelectedCachedBuilding,
  replaceCachedDevicePhoto,
  syncPendingBarcodeAssignments,
} from "./lib/offlineCache";
import { appColors } from "./theme";

type DeviceDetailsPageProps = {
  googleClientId: string;
};

type ScannerProfileId = "1080P" | "720P";

type DetailRowProps = {
  icon: ReactNode;
  label: string;
  value: string;
  valueColor?: string;
  valueAdornment?: ReactNode;
  helperText?: string | null;
};

function DetailRow({ icon, label, value, valueColor, valueAdornment, helperText }: DetailRowProps) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="flex-start">
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
  const [isLoading, setIsLoading] = useState(true);
  const [cachedPhotoUrl, setCachedPhotoUrl] = useState<string | null>(null);
  const [photoDialogOpen, setPhotoDialogOpen] = useState(false);
  const [barcodeDialogOpen, setBarcodeDialogOpen] = useState(false);
  const [isUpdatingPhoto, setIsUpdatingPhoto] = useState(false);
  const [isAssigningBarcode, setIsAssigningBarcode] = useState(false);
  const [barcodeCameraError, setBarcodeCameraError] = useState<string | null>(null);
  const [flashlightSupported, setFlashlightSupported] = useState(false);
  const [flashlightEnabled, setFlashlightEnabled] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const barcodeScannerContainerRef = useRef<HTMLDivElement | null>(null);
  const barcodeDetectedHandlerRef = useRef<((result: QuaggaJSResultObject) => void) | null>(null);
  const barcodeProcessedHandlerRef = useRef<((result: QuaggaJSResultObject) => void) | null>(null);
  const barcodeProcessingRef = useRef(false);
  const barcodeFeedbackResetTimerRef = useRef<number | null>(null);
  const barcodeFeedbackStateRef = useRef<"SUCCESS" | "FAILURE" | null>(null);
  const scannerProfileRef = useRef<ScannerProfileId>("1080P");
  const scannerFpsSamplesRef = useRef<number[]>([]);
  const scannerFallbackTriggeredRef = useRef(false);
  const scannerRestartPendingRef = useRef(false);
  const activeObjectUrlRef = useRef<string | null>(null);

  const loadDeviceDetails = async (deviceId: string) => {
    const [selectedBuilding, cachedDevice] = await Promise.all([
      getSelectedCachedBuilding(),
      getCachedDeviceDetails(deviceId),
    ]);

    setBuildingName(selectedBuilding?.name ?? null);
    setDevice(cachedDevice);
  };

  useEffect(() => {
    if (!user || !id) {
      setDevice(null);
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

  const stopBarcodeScanner = () => {
    const stream = barcodeScannerContainerRef.current
      ?.querySelector("video")
      ?.srcObject;
    const track = stream instanceof MediaStream ? stream.getVideoTracks()[0] : null;
    if (track && flashlightEnabled) {
      void track
        .applyConstraints({ advanced: [{ torch: false } as MediaTrackConstraintSet] })
        .catch(() => undefined);
    }

    if (barcodeDetectedHandlerRef.current) {
      Quagga.offDetected(barcodeDetectedHandlerRef.current);
      barcodeDetectedHandlerRef.current = null;
    } else {
      Quagga.offDetected();
    }
    if (barcodeProcessedHandlerRef.current) {
      Quagga.offProcessed(barcodeProcessedHandlerRef.current);
      barcodeProcessedHandlerRef.current = null;
    } else {
      Quagga.offProcessed();
    }
    void Quagga.stop().catch(() => undefined);
    barcodeProcessingRef.current = false;
    if (barcodeFeedbackResetTimerRef.current !== null) {
      window.clearTimeout(barcodeFeedbackResetTimerRef.current);
      barcodeFeedbackResetTimerRef.current = null;
    }
    barcodeFeedbackStateRef.current = null;
    scannerFpsSamplesRef.current = [];

    if (Quagga.canvas?.ctx?.overlay && Quagga.canvas?.dom?.overlay) {
      Quagga.canvas.ctx.overlay.clearRect(
        0,
        0,
        Quagga.canvas.dom.overlay.width,
        Quagga.canvas.dom.overlay.height,
      );
    }

    setIsAssigningBarcode(false);
    setFlashlightEnabled(false);
    setFlashlightSupported(false);
  };

  const scheduleFallbackTo720p = () => {
    if (scannerRestartPendingRef.current) {
      return;
    }
    scannerRestartPendingRef.current = true;
    scannerProfileRef.current = "720P";
    window.setTimeout(() => {
      scannerRestartPendingRef.current = false;
      if (barcodeDialogOpen && !barcodeProcessingRef.current) {
        startBarcodeScanner("720P");
      }
    }, 120);
  };

  const tryBoostTrackToMaxResolution = async () => {
    const stream = barcodeScannerContainerRef.current
      ?.querySelector("video")
      ?.srcObject;
    const track = stream instanceof MediaStream ? stream.getVideoTracks()[0] : null;
    if (!track) {
      return;
    }
    const capabilities =
      typeof track.getCapabilities === "function"
        ? (track.getCapabilities() as MediaTrackCapabilities & {
            width?: { max?: number };
            height?: { max?: number };
          })
        : null;
    const maxWidth = capabilities?.width?.max;
    const maxHeight = capabilities?.height?.max;
    if (typeof maxWidth !== "number" || typeof maxHeight !== "number") {
      return;
    }

    await track
      .applyConstraints({
        width: { exact: maxWidth },
        height: { exact: maxHeight },
      })
      .catch(() => undefined);
  };

  const setBarcodeFeedbackState = (state: "SUCCESS" | "FAILURE" | null) => {
    if (barcodeFeedbackResetTimerRef.current !== null) {
      window.clearTimeout(barcodeFeedbackResetTimerRef.current);
      barcodeFeedbackResetTimerRef.current = null;
    }
    barcodeFeedbackStateRef.current = state;
    if (state) {
      barcodeFeedbackResetTimerRef.current = window.setTimeout(() => {
        barcodeFeedbackStateRef.current = null;
        barcodeFeedbackResetTimerRef.current = null;
      }, 1000);
    }
  };

  const detectFlashlightSupport = () => {
    const stream = barcodeScannerContainerRef.current
      ?.querySelector("video")
      ?.srcObject;
    const track = stream instanceof MediaStream ? stream.getVideoTracks()[0] : null;
    const capabilities =
      typeof track?.getCapabilities === "function"
        ? (track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean })
        : null;
    setFlashlightSupported(Boolean(capabilities?.torch));

    const zoomCapabilities = capabilities as MediaTrackCapabilities & {
      zoom?: { min?: number; max?: number };
    };
    const minZoom = zoomCapabilities.zoom?.min;
    if (track && typeof minZoom === "number") {
      void track
        .applyConstraints({ advanced: [{ zoom: minZoom } as MediaTrackConstraintSet] })
        .catch(() => undefined);
    }

    if (track) {
      void track
        .applyConstraints({
          advanced: [{ focusMode: "continuous" } as unknown as MediaTrackConstraintSet],
        })
        .catch(() => undefined);
    }
  };

  const toggleFlashlight = async () => {
    const stream = barcodeScannerContainerRef.current
      ?.querySelector("video")
      ?.srcObject;
    const track = stream instanceof MediaStream ? stream.getVideoTracks()[0] : null;
    if (!track) {
      setBarcodeCameraError("A zseblámpa nem érhető el.");
      return;
    }

    const nextState = !flashlightEnabled;
    try {
      await track.applyConstraints({
        advanced: [{ torch: nextState } as MediaTrackConstraintSet],
      });
      setFlashlightEnabled(nextState);
    } catch {
      setBarcodeCameraError(
        nextState
          ? "A zseblámpát nem sikerült bekapcsolni."
          : "A zseblámpát nem sikerült kikapcsolni.",
      );
    }
  };

  const startBarcodeScanner = (profile: ScannerProfileId = "1080P") => {
    if (!barcodeDialogOpen || !barcodeScannerContainerRef.current) {
      return;
    }

    scannerProfileRef.current = profile;
    stopBarcodeScanner();
    setBarcodeCameraError(null);
    setIsAssigningBarcode(true);

    const onDetected = async (result: QuaggaJSResultObject) => {
      if (!barcodeDialogOpen || !id || barcodeProcessingRef.current) {
        return;
      }

      const scannedCode = result.codeResult.code?.trim() ?? "";
      if (!scannedCode) {
        return;
      }

      const validation = validateNomaBarcode(scannedCode);
      if (validation.error) {
        if (validation.error === "A detektált kód nem NoMa vonalkód") {
          console.warn("Scanned non-NoMa barcode:", scannedCode);
        }
        setBarcodeFeedbackState("FAILURE");
        setBarcodeCameraError(validation.error);
        return;
      }
      const identifier = validation.identifier;
      if (!identifier) {
        return;
      }

      barcodeProcessingRef.current = true;
      setBarcodeFeedbackState("SUCCESS");
      setIsAssigningBarcode(true);

      try {
        await assignCachedDeviceBarcode(id, identifier);
        await syncPendingBarcodeAssignments();
        await loadDeviceDetails(id);
        stopBarcodeScanner();
        setBarcodeDialogOpen(false);
      } catch (error) {
        setBarcodeFeedbackState("FAILURE");
        setBarcodeCameraError(
          error instanceof Error
            ? error.message
            : "Nem sikerült elmenteni a beolvasott vonalkódot.",
        );
        barcodeProcessingRef.current = false;
      } finally {
        if (barcodeDialogOpen && !barcodeProcessingRef.current) {
          setIsAssigningBarcode(false);
        }
      }
    };

    const onProcessed = (result: QuaggaJSResultObject) => {
      const ctx = Quagga.canvas?.ctx?.overlay;
      const canvas = Quagga.canvas?.dom?.overlay;
      if (!ctx || !canvas) {
        return;
      }

      const now = performance.now();
      const samples = scannerFpsSamplesRef.current;
      samples.push(now);
      if (samples.length > 24) {
        samples.shift();
      }
      if (
        samples.length >= 10 &&
        !scannerFallbackTriggeredRef.current &&
        scannerProfileRef.current !== "720P"
      ) {
        const elapsedMs = samples[samples.length - 1] - samples[0];
        if (elapsedMs > 0) {
          const fps = ((samples.length - 1) * 1000) / elapsedMs;
          if (fps < 6) {
            scannerFallbackTriggeredRef.current = true;
            scheduleFallbackTo720p();
            return;
          }
        }
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (result?.boxes) {
        result.boxes
          .filter((box) => box !== result.box)
          .forEach((box) => {
            Quagga.ImageDebug.drawPath(box as unknown[], { x: 0, y: 1 }, ctx, {
              color: "rgba(255, 255, 255, 0.55)",
              lineWidth: 1,
            });
          });
      }

      if (result?.box) {
        const state = barcodeFeedbackStateRef.current;
        const activeColor =
          state === "SUCCESS"
            ? "#22C55E"
            : state === "FAILURE"
              ? "#EF4444"
              : "#EAB308";

        Quagga.ImageDebug.drawPath(result.box as unknown[], { x: 0, y: 1 }, ctx, {
          color: activeColor,
          lineWidth: 3,
        });
      }
    };

    barcodeDetectedHandlerRef.current = onDetected;
    barcodeProcessedHandlerRef.current = onProcessed;

    const constraints =
      profile === "720P"
        ? {
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          }
        : {
            facingMode: "environment",
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          };

    void Quagga.init({
      inputStream: {
        type: "LiveStream",
        target: barcodeScannerContainerRef.current,
        constraints,
        area: {
          top: "35%",
          right: "14%",
          left: "14%",
          bottom: "35%",
        },
      },
      decoder: {
        readers: ["code_128_reader"],
      },
      locator: {
        patchSize: "medium",
        halfSample: true,
      },
      locate: true,
      numOfWorkers:
        typeof navigator !== "undefined" && typeof navigator.hardwareConcurrency === "number"
          ? Math.max(1, Math.min(4, navigator.hardwareConcurrency))
          : 2,
      frequency: 10,
    })
      .then(() => {
        Quagga.onDetected(onDetected);
        Quagga.onProcessed(onProcessed);
        Quagga.start();
        setIsAssigningBarcode(false);
        if (profile === "1080P") {
          void tryBoostTrackToMaxResolution();
        }
        window.setTimeout(() => {
          detectFlashlightSupport();
        }, 0);
      })
      .catch(() => {
        setBarcodeCameraError("Nem sikerült elindítani a kamerát.");
        setIsAssigningBarcode(false);
      });
  };

  useEffect(() => {
    if (!barcodeDialogOpen) {
      stopBarcodeScanner();
      setBarcodeCameraError(null);
      scannerFallbackTriggeredRef.current = false;
      scannerProfileRef.current = "1080P";
    }

    return () => {
      stopBarcodeScanner();
    };
  }, [barcodeDialogOpen]);

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

  const handleSyncStatusClick = async () => {
    if (!id) {
      return;
    }

    const selectedBuilding = await getSelectedCachedBuilding();
    if (!selectedBuilding) {
      return;
    }

    try {
      const response = await fetch(`/api/labeling/buildings/${selectedBuilding.id}/cache`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Nem sikerült frissíteni az offline adatokat.");
      }

      const payload = (await response.json()) as BuildingCachePayload;
      await cacheBuildingData(payload, selectedBuilding.id);
      await loadDeviceDetails(id);
    } catch (error) {
      throw error;
    }
  };

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
  const shouldShowBarcodeFab = device ? device.code == null || device.codeSyncState === "FAILED" : false;

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
        onBuildingClick={() => navigate("/")}
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
              onClick={() => navigate("/")}
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
                          ) : null
                        }
                        helperText={barcodeHasSyncError ? device.codeSyncError : null}
                      />
                      <DetailRow
                        icon={<CategoryOutlined fontSize="small" />}
                        label="Eszköz típusa"
                        value={getDeviceKindLabel(device.kind)}
                      />
                      <DetailRow
                        icon={<Inventory2Outlined fontSize="small" />}
                        label="Márka"
                        value={device.brand ?? "Nincs megadva"}
                      />
                      <DetailRow
                        icon={<InfoOutlined fontSize="small" />}
                        label="Gyári szám"
                        value={device.serialNumber ?? "Nincs megadva"}
                      />
                      <DetailRow
                        icon={<InfoOutlined fontSize="small" />}
                        label="Eszköz azonosító"
                        value={device.sourceDeviceCode ?? "Nincs megadva"}
                      />
                      <DetailRow
                        icon={<InfoOutlined fontSize="small" />}
                        label="Megjegyzés"
                        value={device.additionalInfo ?? "Nincs megadva"}
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
              </Stack>
            )}
          </Paper>
        </Stack>
      </Box>

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
