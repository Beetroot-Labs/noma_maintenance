import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  Dialog,
  IconButton,
  TextField,
  Typography,
} from "@mui/material";
import { ArrowLeft, ArrowRight, Flashlight, FlashlightOff, Keyboard, ScanBarcode, X } from "lucide-react";
import { getCachedBuildingSnapshot, useCode128Scanner, validateNomaBarcode } from "@noma/shared";
import { Layout } from "@/components/Layout";
import { appColors } from "@/theme";
import { useMaintenance } from "@/context/MaintenanceContext";
import { toast } from "@/lib/toast";
import { useDemoUser } from "@/context/DemoUserContext";

type CurrentShiftSummary = {
  id: string;
};

type ShiftWaitingRoomPayload = {
  building_id: string;
};

export default function NewMaintenancePage() {
  const navigate = useNavigate();
  const { user } = useDemoUser();
  const { startMaintenance, todaysWorks, pastWorks } = useMaintenance();
  const [hvacId, setHvacId] = useState("");
  const [scannerOpen, setScannerOpen] = useState(true);
  const [isLoadingBarcodeOptions, setIsLoadingBarcodeOptions] = useState(true);
  const [barcodeOptions, setBarcodeOptions] = useState<string[]>([]);
  const scannerContainerRef = useRef<HTMLDivElement | null>(null);
  const validBarcodeSet = useMemo(() => new Set(barcodeOptions), [barcodeOptions]);
  const findLatestMaintenanceForDevice = (hvacId: string) => {
    const allWorks = [...todaysWorks, ...pastWorks].filter((work) => work.hvacId === hvacId);
    if (allWorks.length === 0) {
      return null;
    }
    return allWorks.sort((left, right) => {
      const leftTime = (left.endTime ?? left.startTime).getTime();
      const rightTime = (right.endTime ?? right.startTime).getTime();
      return rightTime - leftTime;
    })[0] ?? null;
  };

  const {
    isStarting: isScannerStarting,
    cameraError,
    setCameraError,
    flashlightSupported,
    flashlightEnabled,
    start: startScanner,
    stop: stopScanner,
    toggleFlashlight,
  } = useCode128Scanner({
    containerRef: scannerContainerRef,
    onDetected: async (scannedCode) => {
      const validation = validateNomaBarcode(scannedCode);
      if (validation.error) {
        console.warn("Barcode validation error:", validation.error, "Scanned barcode:", scannedCode);
        return { status: "failure", errorMessage: validation.error };
      }
      const identifier = validation.identifier;
      if (!identifier) {
        return { status: "ignore" };
      }
      if (!validBarcodeSet.has(identifier)) {
        return {
          status: "failure",
          errorMessage: "A beolvasott vonalkód nincs hozzárendelve eszközhöz ebben az épületben.",
        };
      }
      const existingMaintenance = findLatestMaintenanceForDevice(identifier);
      if (existingMaintenance) {
        setHvacId(identifier);
        setScannerOpen(false);
        toast.info("Ehhez az eszközhöz már van rögzített karbantartás, annak adatlapja nyílik meg.");
        navigate(`/maintenance/${existingMaintenance.id}`);
        return { status: "success" };
      }
      setHvacId(identifier);
      setScannerOpen(false);
      const workId = await startMaintenance(identifier);
      if (!workId) {
        return {
          status: "failure",
          errorMessage: "A beolvasott vonalkódhoz nem található gyorsítótárazott eszközadat.",
        };
      }
      toast.success(`Beolvasva: ${identifier}`);
      toast.success("Karbantartás elindítva!");
      navigate(`/maintenance/${workId}`);
      return { status: "success" };
    },
  });

  const isSubsequenceMatch = (query: string, candidate: string) => {
    let queryIndex = 0;
    for (let i = 0; i < candidate.length && queryIndex < query.length; i += 1) {
      if (candidate[i] === query[queryIndex]) {
        queryIndex += 1;
      }
    }
    return queryIndex === query.length;
  };

  useEffect(() => {
    let cancelled = false;

    const loadBarcodeOptions = async () => {
      if (!user?.tenantId) {
        setBarcodeOptions([]);
        setIsLoadingBarcodeOptions(false);
        return;
      }

      setIsLoadingBarcodeOptions(true);
      try {
        const currentShiftResponse = await fetch("/api/shifts/current", {
          credentials: "include",
          cache: "no-store",
        });
        if (!currentShiftResponse.ok) {
          if (!cancelled) {
            setBarcodeOptions([]);
          }
          return;
        }
        const currentShiftPayload = (await currentShiftResponse.json()) as {
          shift: CurrentShiftSummary | null;
        };
        if (!currentShiftPayload.shift?.id) {
          if (!cancelled) {
            setBarcodeOptions([]);
          }
          return;
        }

        const waitingRoomResponse = await fetch(
          `/api/shifts/${currentShiftPayload.shift.id}/waiting-room`,
          {
            credentials: "include",
            cache: "no-store",
          },
        );
        if (!waitingRoomResponse.ok) {
          if (!cancelled) {
            setBarcodeOptions([]);
          }
          return;
        }
        const waitingRoomPayload = (await waitingRoomResponse.json()) as ShiftWaitingRoomPayload;
        const snapshot = await getCachedBuildingSnapshot(user.tenantId, waitingRoomPayload.building_id);
        const codes = Array.from(
          new Set(
            (snapshot?.devices ?? [])
              .map((device) => device.code?.trim() ?? "")
              .filter((code): code is string => code.length > 0),
          ),
        ).sort((a, b) => a.localeCompare(b, "hu-HU"));

        if (!cancelled) {
          setBarcodeOptions(codes);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingBarcodeOptions(false);
        }
      }
    };

    void loadBarcodeOptions();
    return () => {
      cancelled = true;
    };
  }, [user?.tenantId]);

  useEffect(() => {
    if (!scannerOpen) {
      stopScanner();
      return;
    }

    setCameraError(null);
    const frameId = window.requestAnimationFrame(() => {
      startScanner();
    });
    return () => {
      window.cancelAnimationFrame(frameId);
      stopScanner();
    };
  }, [scannerOpen, setCameraError, startScanner, stopScanner]);

  useEffect(() => {
    if (!cameraError) {
      return;
    }
    const timer = window.setTimeout(() => {
      setCameraError(null);
    }, 5000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [cameraError, setCameraError]);

  const handleStart = () => {
    const normalizedCode = hvacId.trim();
    if (!normalizedCode) {
      toast.error("Kérjük, adjon meg vagy olvasson be egy azonosítót");
      return;
    }
    if (!validBarcodeSet.has(normalizedCode)) {
      toast.error("A megadott vonalkód nincs hozzárendelve eszközhöz ebben az épületben.");
      return;
    }
    const existingMaintenance = findLatestMaintenanceForDevice(normalizedCode);
    if (existingMaintenance) {
      toast.info("Ehhez az eszközhöz már van rögzített karbantartás, annak adatlapja nyílik meg.");
      navigate(`/maintenance/${existingMaintenance.id}`);
      return;
    }

    void (async () => {
      const workId = await startMaintenance(normalizedCode);
      if (!workId) {
        toast.error("A megadott vonalkódhoz nem található gyorsítótárazott eszközadat.");
        return;
      }
      toast.success("Karbantartás elindítva!");
      navigate(`/maintenance/${workId}`);
    })();
  };

  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <IconButton onClick={() => navigate(-1)} aria-label="Vissza">
            <ArrowLeft size={18} />
          </IconButton>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Új karbantartás
          </Typography>
        </Box>

        <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
          <CardHeader
            disableTypography
            title={
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Keyboard size={18} color={appColors.primary} />
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Kézi bevitel
                </Typography>
              </Box>
            }
          />
          <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                Egység azonosítója
              </Typography>
              <Autocomplete
                freeSolo
                options={barcodeOptions}
                openOnFocus
                loading={isLoadingBarcodeOptions}
                filterOptions={(options, state) => {
                  const query = state.inputValue.trim();
                  if (!query) return options;
                  return options.filter((id) => isSubsequenceMatch(query, id));
                }}
                inputValue={hvacId}
                onInputChange={(_, value) => setHvacId(value)}
                onChange={(_, value) => {
                  if (typeof value === "string") {
                    setHvacId(value);
                  }
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    placeholder="pl. DEMO-DEVICE-001"
                    fullWidth
                    autoFocus
                  />
                )}
              />
            </Box>
            {hvacId.trim() && validBarcodeSet.has(hvacId.trim()) && (
              <Button
                variant="contained"
                size="large"
                onClick={handleStart}
                fullWidth
                endIcon={<ArrowRight size={18} />}
                sx={{
                  bgcolor: appColors.accent,
                  color: appColors.accentForeground,
                  "&:hover": { bgcolor: "hsl(36 95% 45%)" },
                }}
              >
                Karbantartás megkezdése
              </Button>
            )}
          </CardContent>
        </Card>

        <Button
          variant="text"
          onClick={() => {
            setCameraError(null);
            setScannerOpen(true);
          }}
          startIcon={<ScanBarcode size={18} />}
          sx={{ alignSelf: "center" }}
        >
          Inkább vonalkód-olvasót használok
        </Button>
      </Box>

      <Dialog
        open={scannerOpen}
        fullScreen
        onClose={() => {
          if (!isScannerStarting) {
            setScannerOpen(false);
          }
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
            ref={scannerContainerRef}
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

          <Box
            sx={{
              position: "absolute",
              top: "max(12px, env(safe-area-inset-top))",
              left: 0,
              right: 0,
              px: 1.5,
              display: "grid",
              gridTemplateColumns: "1fr auto 1fr",
              alignItems: "center",
            }}
          >
            <Box sx={{ display: "flex", justifyContent: "flex-start" }}>
              <IconButton
                onClick={() => navigate(-1)}
                sx={{
                  color: "common.white",
                  bgcolor: "rgba(0, 0, 0, 0.45)",
                  "&:hover": { bgcolor: "rgba(0, 0, 0, 0.6)" },
                }}
                aria-label="Bezárás"
              >
                <X size={18} />
              </IconButton>
            </Box>

            <Box sx={{ display: "flex", justifyContent: "center" }}>
              <IconButton
                onClick={() => setScannerOpen(false)}
                sx={{
                  color: "common.white",
                  bgcolor: "rgba(0, 0, 0, 0.45)",
                  "&:hover": { bgcolor: "rgba(0, 0, 0, 0.6)" },
                }}
                aria-label="Kézi bevitel"
              >
                <Keyboard size={18} />
              </IconButton>
            </Box>

            <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
              <IconButton
                onClick={toggleFlashlight}
                disabled={!flashlightSupported || isScannerStarting}
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
            </Box>
          </Box>

          {isScannerStarting && !cameraError && (
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

          {cameraError ? (
            <Box
              sx={{
                position: "absolute",
                bottom: "max(20px, env(safe-area-inset-bottom))",
                left: "50%",
                transform: "translateX(-50%)",
                px: 1.5,
                py: 0.9,
                borderRadius: "5px",
                bgcolor: "rgba(220, 38, 38, 0.9)",
                color: "common.white",
                maxWidth: "min(92vw, 520px)",
                textAlign: "center",
              }}
            >
              <Typography variant="body2" sx={{ color: "common.white", fontWeight: 600 }}>
                {cameraError}
              </Typography>
            </Box>
          ) : null}
        </Box>
      </Dialog>
    </Layout>
  );
}
