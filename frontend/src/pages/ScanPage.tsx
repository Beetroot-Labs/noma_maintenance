import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Divider,
  IconButton,
  TextField,
  Typography,
} from "@mui/material";
import { Keyboard, ScanBarcode, X, ArrowRight } from "lucide-react";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { Layout } from "@/components/Layout";
import { appColors } from "@/theme";
import { hvacDatabase, useMaintenance } from "@/context/MaintenanceContext";
import { toast } from "@/lib/toast";

export default function ScanPage() {
  const navigate = useNavigate();
  const { startMaintenance } = useMaintenance();
  const [manualEntry, setManualEntry] = useState(false);
  const [hvacId, setHvacId] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const deviceIds = useMemo(() => Object.keys(hvacDatabase), []);

  const isSubsequenceMatch = (query: string, candidate: string) => {
    let queryIndex = 0;
    for (let i = 0; i < candidate.length && queryIndex < query.length; i += 1) {
      if (candidate[i] === query[queryIndex]) {
        queryIndex += 1;
      }
    }
    return queryIndex === query.length;
  };

  const handleScan = () => {
    setScannerOpen((prev) => !prev);
  };

  const stopScanner = () => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    readerRef.current = null;
    setIsScanning(false);
  };

  useEffect(() => {
    if (!scannerOpen) {
      stopScanner();
      return;
    }

    let active = true;
    setCameraError(null);
    setIsScanning(true);

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_39]);
    const reader = new BrowserMultiFormatReader(hints, 400);
    readerRef.current = reader;

    reader
      .decodeFromVideoDevice(null, videoRef.current, (result, error, controls) => {
        if (!active) return;
        if (controls && !controlsRef.current) {
          controlsRef.current = controls;
          setIsScanning(false);
        }
        if (result) {
          const scannedId = result.getText().trim().toUpperCase();
          setHvacId(scannedId);
          stopScanner();
          setScannerOpen(false);
          const workId = startMaintenance(scannedId);
          toast.success(`Beolvasva: ${scannedId}`);
          toast.success("Karbantartás elindítva!");
          navigate(`/maintenance/${workId}`);
        }
        if (error) {
          // ignore decode errors while scanning
        }
      })
      .catch(() => {
        setCameraError("Nem sikerült elindítani a kamerát.");
        setIsScanning(false);
      });

    return () => {
      active = false;
      stopScanner();
    };
  }, [navigate, scannerOpen, startMaintenance]);

  const handleStart = () => {
    if (!hvacId.trim()) {
      toast.error("Kérjük, adjon meg vagy olvasson be egy azonosítót");
      return;
    }

    const workId = startMaintenance(hvacId.trim().toUpperCase());
    toast.success("Karbantartás elindítva!");
    navigate(`/maintenance/${workId}`);
  };

  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3, animation: "slideUp 0.3s ease-out" }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Egység azonosítása
          </Typography>
          <IconButton onClick={() => navigate("/")}>
            <X size={18} />
          </IconButton>
        </Box>

        <Box
          sx={{
            display: "grid",
            gap: 3,
            gridTemplateColumns: { xs: "1fr", md: "1.2fr 0.8fr" },
            alignItems: "start",
          }}
        >
          {!manualEntry ? (
            <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
              <CardHeader
                disableTypography
                title={
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <ScanBarcode size={18} color={appColors.primary} />
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      Vonalkód beolvasása
                    </Typography>
                  </Box>
                }
              />
              <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <Box
                  sx={{
                    aspectRatio: "16 / 9",
                    bgcolor: appColors.muted,
                    borderRadius: 2,
                    border: `2px dashed ${appColors.border}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                  }}
                >
                  {scannerOpen ? (
                    <Box sx={{ width: "100%", height: "100%", bgcolor: "#000" }}>
                      <Box
                        component="video"
                        ref={videoRef}
                        sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                        muted
                      />
                    </Box>
                  ) : isScanning ? (
                    <Box sx={{ textAlign: "center" }}>
                      <Box sx={{ animation: "pulseSoft 1.2s ease-in-out infinite" }}>
                        <ScanBarcode size={48} color={appColors.primary} />
                      </Box>
                      <Typography variant="body2" color="text.secondary">
                        Beolvasás...
                      </Typography>
                    </Box>
                  ) : hvacId ? (
                    <Box sx={{ textAlign: "center" }}>
                      <Typography variant="h5" sx={{ fontWeight: 700, color: appColors.primary }}>
                        {hvacId}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Vonalkód beolvasva
                      </Typography>
                    </Box>
                  ) : (
                    <Box sx={{ textAlign: "center", color: appColors.mutedForeground }}>
                      <ScanBarcode size={40} />
                      <Typography variant="body2" sx={{ mt: 1 }}>
                        Kamera kép a beolvasáshoz
                      </Typography>
                    </Box>
                  )}
                </Box>
                {cameraError && (
                  <Typography variant="body2" color="error">
                    {cameraError}
                  </Typography>
                )}

                <Button
                  variant="contained"
                  onClick={handleScan}
                  disabled={!scannerOpen && isScanning}
                  fullWidth
                  startIcon={<ScanBarcode size={18} />}
                >
                  {scannerOpen
                    ? "Beolvasás leállítása"
                    : isScanning
                      ? "Beolvasás..."
                      : "Vonalkód beolvasása"}
                </Button>

                <Box sx={{ position: "relative", textAlign: "center" }}>
                  <Divider />
                  <Typography
                    variant="caption"
                    sx={{
                      position: "relative",
                      top: "-11px",
                      bgcolor: appColors.card,
                      px: 1,
                      textTransform: "uppercase",
                      color: "text.secondary",
                    }}
                  >
                    vagy
                  </Typography>
                </Box>

                <Button
                  variant="outlined"
                  onClick={() => {
                    setScannerOpen(false);
                    setManualEntry(true);
                  }}
                  fullWidth
                  startIcon={<Keyboard size={18} />}
                >
                  Kézi bevitel
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
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
                      options={deviceIds}
                      openOnFocus
                      filterOptions={(options, state) => {
                        const query = state.inputValue.trim().toUpperCase();
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
                  {hvacId && hvacDatabase[hvacId.toUpperCase()] && (
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
                  setManualEntry(false);
                  setHvacId("");
                }}
                startIcon={<ScanBarcode size={18} />}
                sx={{ alignSelf: "center" }}
              >
                Inkább vonalkód-olvasót használok
              </Button>
            </Box>
          )}
        </Box>
      </Box>
    </Layout>
  );
}
