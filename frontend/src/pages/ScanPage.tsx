import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
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
import { ArrowRight, Keyboard, ScanBarcode, X } from "lucide-react";
import { Layout } from "@/components/Layout";
import { appColors } from "@/theme";
import { useMaintenance } from "@/context/MaintenanceContext";
import { toast } from "@/lib/toast";

export default function ScanPage() {
  const navigate = useNavigate();
  const { startMaintenance } = useMaintenance();
  const [manualEntry, setManualEntry] = useState(false);
  const [hvacId, setHvacId] = useState("");
  const [isScanning, setIsScanning] = useState(false);

  const handleScan = () => {
    setIsScanning(true);
    setTimeout(() => {
      const mockIds = ["HVAC-001", "HVAC-002", "HVAC-003", "HVAC-004", "HVAC-005"];
      const scannedId = mockIds[Math.floor(Math.random() * mockIds.length)];
      setHvacId(scannedId);
      setIsScanning(false);
      toast.success(`Beolvasva: ${scannedId}`);
    }, 1500);
  };

  const handleStart = () => {
    if (!hvacId.trim()) {
      toast.error("Kérjük, adjon meg vagy olvasson be egy HVAC azonosítót");
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
            HVAC egység azonosítása
          </Typography>
          <IconButton onClick={() => navigate("/")}>
            <X size={18} />
          </IconButton>
        </Box>

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
                }}
              >
                {isScanning ? (
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

              <Button
                variant="contained"
                onClick={handleScan}
                disabled={isScanning}
                fullWidth
                startIcon={<ScanBarcode size={18} />}
              >
                {isScanning ? "Beolvasás..." : "Vonalkód beolvasása"}
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
                onClick={() => setManualEntry(true)}
                fullWidth
                startIcon={<Keyboard size={18} />}
              >
                Kézi bevitel
              </Button>
            </CardContent>
          </Card>
        ) : (
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
                  HVAC egység azonosító
                </Typography>
                <TextField
                  placeholder="pl. HVAC-001"
                  value={hvacId}
                  onChange={(event) => setHvacId(event.target.value)}
                  fullWidth
                  autoFocus
                />
              </Box>
              <Button
                variant="outlined"
                onClick={() => {
                  setManualEntry(false);
                  setHvacId("");
                }}
                fullWidth
                startIcon={<ScanBarcode size={18} />}
              >
                Inkább vonalkód-olvasót használok
              </Button>
            </CardContent>
          </Card>
        )}

        {hvacId && (
          <Button
            variant="contained"
            size="large"
            onClick={handleStart}
            fullWidth
            endIcon={<ArrowRight size={18} />}
            sx={{
              bgcolor: appColors.accent,
              color: appColors.accentForeground,
              "&:hover": { bgcolor: "hsl(15 65% 50%)" },
            }}
          >
            Karbantartás indítása
          </Button>
        )}
      </Box>
    </Layout>
  );
}
