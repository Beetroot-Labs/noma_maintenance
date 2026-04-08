import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import SigPad from "signature_pad";
import {
  Alert,
  Box,
  Button,
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
  TextField,
  Typography,
} from "@mui/material";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { useDemoUser } from "@/context/DemoUserContext";
import { useShift } from "@/context/ShiftContext";
import { toast } from "@/lib/toast";
import { appColors } from "@/theme";

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

type SignaturePoint = {
  x: number;
  y: number;
};

type SignatureStroke = SignaturePoint[];

type SignaturePadHandle = {
  isEmpty: () => boolean;
  toStrokes: () => SignatureStroke[];
  toPngBlob: () => Promise<Blob>;
};

const SIGNATURE_EXPORT_WIDTH = 1200;
const SIGNATURE_EXPORT_HEIGHT = 360;

const formatFinishedTime = (value: string | null) => {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("hu-HU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
};

const formatCurrentDate = (value: Date) =>
  new Intl.DateTimeFormat("hu-HU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);

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

const formatBrandModel = (row: ShiftMaintenanceSummaryRow) => {
  const parts = [row.device_brand?.trim(), row.device_model?.trim()].filter(Boolean);
  if (parts.length > 0) {
    return parts.join(" ");
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

const hasSignatureStrokes = (padRef: React.RefObject<SignaturePadHandle | null>) =>
  !(padRef.current?.isEmpty() ?? true);

type SignaturePadProps = {
  onIsEmptyChange: (isEmpty: boolean) => void;
};

const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(({ onIsEmptyChange }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SigPad | null>(null);
  const onIsEmptyChangeRef = useRef(onIsEmptyChange);
  const [isEmpty, setIsEmpty] = useState(true);

  useEffect(() => {
    onIsEmptyChangeRef.current = onIsEmptyChange;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const initCanvas = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = canvas.offsetWidth * ratio;
      canvas.height = canvas.offsetHeight * ratio;
      canvas.getContext("2d")?.scale(ratio, ratio);
    };

    initCanvas();

    const pad = new SigPad(canvas, { penColor: appColors.primary });
    padRef.current = pad;

    const handleEndStroke = () => {
      const empty = pad.isEmpty();
      setIsEmpty(empty);
      onIsEmptyChangeRef.current(empty);
    };

    pad.addEventListener("endStroke", handleEndStroke);

    const observer = new ResizeObserver(() => {
      const data = pad.toData();
      initCanvas();
      pad.clear();
      pad.fromData(data);
    });

    if (containerRef.current) observer.observe(containerRef.current);

    return () => {
      pad.off();
      observer.disconnect();
    };
  }, []);

  useImperativeHandle(ref, () => ({
    isEmpty: () => padRef.current?.isEmpty() ?? true,
    toStrokes: () =>
      (padRef.current?.toData() ?? []).map((group) =>
        group.points.map((p) => ({ x: p.x, y: p.y })),
      ),
    toPngBlob: async (): Promise<Blob> => {
      const pad = padRef.current;
      const canvas = canvasRef.current;
      if (!pad || !canvas) throw new Error("Az aláírás képének előállítása nem sikerült.");

      const sourceWidth = canvas.offsetWidth;
      const sourceHeight = canvas.offsetHeight;
      const data = pad.toData();

      const offscreen = document.createElement("canvas");
      offscreen.width = SIGNATURE_EXPORT_WIDTH;
      offscreen.height = SIGNATURE_EXPORT_HEIGHT;
      const ctx = offscreen.getContext("2d");
      if (!ctx) throw new Error("Az aláírás képének előállítása nem sikerült.");

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, offscreen.width, offscreen.height);
      ctx.strokeStyle = appColors.primary;
      ctx.fillStyle = appColors.primary;
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      const scaleX = SIGNATURE_EXPORT_WIDTH / sourceWidth;
      const scaleY = SIGNATURE_EXPORT_HEIGHT / sourceHeight;

      for (const group of data) {
        const { points } = group;
        if (points.length === 0) continue;
        if (points.length === 1) {
          ctx.beginPath();
          ctx.arc(points[0].x * scaleX, points[0].y * scaleY, 3, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        ctx.beginPath();
        points.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x * scaleX, p.y * scaleY);
          else ctx.lineTo(p.x * scaleX, p.y * scaleY);
        });
        ctx.stroke();
      }

      return new Promise<Blob>((resolve, reject) => {
        offscreen.toBlob(
          (blob) =>
            blob
              ? resolve(blob)
              : reject(new Error("Az aláírás képének előállítása nem sikerült.")),
          "image/png",
        );
      });
    },
  }));

  const handleClear = () => {
    padRef.current?.clear();
    setIsEmpty(true);
    onIsEmptyChangeRef.current(true);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
      <Box
        ref={containerRef}
        sx={{
          position: "relative",
          minHeight: 180,
          border: `1px dashed ${appColors.border}`,
          borderRadius: 2,
          bgcolor: "background.paper",
          overflow: "hidden",
        }}
      >
        {isEmpty ? (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              px: 2,
              color: "text.secondary",
              pointerEvents: "none",
            }}
          >
            <Typography variant="body2" align="center">
              Írja alá itt érintéssel vagy egérrel.
            </Typography>
          </Box>
        ) : null}
        <canvas
          ref={canvasRef}
          style={{ display: "block", width: "100%", height: 180, touchAction: "none" }}
        />
      </Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 2 }}>
        <Button variant="text" color="inherit" onClick={handleClear}>
          Törlés
        </Button>
      </Box>
    </Box>
  );
});
SignaturePad.displayName = "SignaturePad";

export default function ShiftSummaryPage() {
  const navigate = useNavigate();
  const { shiftId: shiftIdParam } = useParams<{ shiftId?: string }>();
  const { user } = useDemoUser();
  const { currentShift, isLoading: isShiftLoading, refreshCurrentShift } = useShift();

  // When accessed via /shifts/:shiftId/summary use the URL param; otherwise fall back to current shift
  const shiftId = shiftIdParam ?? currentShift?.id;
  const isFromPendingList = Boolean(shiftIdParam);

  const [payload, setPayload] = useState<ShiftMaintenanceSummaryPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [referentName, setReferentName] = useState("");
  const [referentRole, setReferentRole] = useState("");
  const signaturePadRef = useRef<SignaturePadHandle>(null);
  const [isSignatureEmpty, setIsSignatureEmpty] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!shiftId) {
        if (!cancelled) {
          setPayload(null);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/shifts/${shiftId}/maintenance-summary`, {
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
  }, [shiftId]);

  const isLeadOrAdmin = user?.role === "admin" || user?.role === "lead_technician";

  const rows = useMemo(() => payload?.maintenances ?? [], [payload]);
  const todayLabel = useMemo(() => formatCurrentDate(new Date()), []);
  const canSubmit =
    referentName.trim().length > 0 &&
    referentRole.trim().length > 0 &&
    !isSignatureEmpty &&
    !isSubmitting;

  const handleBack = () => {
    if (isFromPendingList) {
      navigate("/pending-worksheets");
    } else {
      navigate("/shift-details");
    }
  };

  const handleCommitShift = async () => {
    if (!shiftId || !isLeadOrAdmin) {
      return;
    }

    if (!referentName.trim()) {
      toast.error("A referens neve kötelező.");
      return;
    }

    if (!referentRole.trim()) {
      toast.error("A referens beosztása kötelező.");
      return;
    }

    if (!hasSignatureStrokes(signaturePadRef)) {
      toast.error("A műszak véglegesítéséhez aláírás szükséges.");
      return;
    }

    setIsSubmitting(true);
    try {
      const signatureBlob = await signaturePadRef.current!.toPngBlob();
      const uploadResponse = await fetch(`/api/shifts/${shiftId}/signature-image`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "image/png",
        },
        body: signatureBlob,
      });

      if (!uploadResponse.ok) {
        throw new Error(
          await readApiErrorMessage(
            uploadResponse,
            "Nem sikerült feltölteni az aláírást.",
          ),
        );
      }

      const uploadPayload = (await uploadResponse.json()) as {
        signature_image_url: string;
      };

      const response = await fetch(`/api/shifts/${shiftId}/commit`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reference_person_name: referentName.trim(),
          reference_person_role: referentRole.trim(),
          signature_strokes: signaturePadRef.current!.toStrokes(),
          signature_image_url: uploadPayload.signature_image_url,
        }),
      });

      if (!response.ok) {
        throw new Error(
          await readApiErrorMessage(response, "Nem sikerült véglegesíteni a műszakot."),
        );
      }

      await refreshCurrentShift();
      toast.success("A műszak sikeresen véglegesítve.");
      navigate(isFromPendingList ? "/pending-worksheets" : "/");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Nem sikerült véglegesíteni a műszakot.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isFromPendingList && isShiftLoading) {
    return (
      <Layout>
        <Box sx={{ py: 6, display: "grid", placeItems: "center" }}>
          <CircularProgress color="secondary" />
        </Box>
      </Layout>
    );
  }

  if (!shiftId) {
    return null;
  }

  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <IconButton onClick={handleBack} aria-label="Vissza">
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
        ) : !isLeadOrAdmin ? (
          <Alert severity="error">Csak a műszakvezető láthatja ezt az oldalt.</Alert>
        ) : (
          <>
            <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
              <CardContent sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    {payload.building_name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Dátum: {todayLabel}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Műszakvezető: {payload.lead_user_name}
                  </Typography>
                </Box>

                <TableContainer sx={{ overflowX: "auto" }}>
                  <Table size="small" sx={{ minWidth: 720 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Helyszín</TableCell>
                        <TableCell>Vonalkód</TableCell>
                        <TableCell>Karbantartás vége</TableCell>
                        <TableCell>Márka + modell</TableCell>
                        <TableCell>Típus</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rows.map((row) => (
                        <TableRow key={row.maintenance_id} hover>
                          <TableCell>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                              <Typography variant="body2">{formatLocation(row)}</Typography>
                              {row.malfunction_description ? (
                                <Box
                                  component="span"
                                  sx={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    color: appColors.destructive,
                                  }}
                                  aria-label="Hibásként jelölt karbantartás"
                                  title="Hibásként jelölt karbantartás"
                                >
                                  <AlertTriangle size={16} />
                                </Box>
                              ) : null}
                            </Box>
                          </TableCell>
                          <TableCell>{row.device_code ?? "-"}</TableCell>
                          <TableCell>{formatFinishedTime(row.finished_at)}</TableCell>
                          <TableCell>{formatBrandModel(row)}</TableCell>
                          <TableCell>{row.device_kind}</TableCell>
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

            <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
              <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    Referens aláírása
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    A műszak igazolásához töltse ki az adatokat és írjon alá a képernyőn.
                  </Typography>
                </Box>

                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
                    gap: 2,
                  }}
                >
                  <TextField
                    label="Név"
                    value={referentName}
                    onChange={(event) => setReferentName(event.target.value)}
                    fullWidth
                  />
                  <TextField
                    label="Beosztás"
                    placeholder="pl. Épületgondnok"
                    value={referentRole}
                    onChange={(event) => setReferentRole(event.target.value)}
                    fullWidth
                  />
                </Box>

                <SignaturePad ref={signaturePadRef} onIsEmptyChange={setIsSignatureEmpty} />

                <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                  <Button
                    variant="contained"
                    onClick={() => void handleCommitShift()}
                    disabled={!canSubmit}
                    sx={{
                      bgcolor: appColors.accent,
                      color: appColors.accentForeground,
                      "&:hover": { bgcolor: "hsl(36 95% 45%)" },
                    }}
                  >
                    {isSubmitting ? "Véglegesítés..." : "Műszak véglegesítése"}
                  </Button>
                </Box>
              </CardContent>
            </Card>
          </>
        )}
      </Box>
    </Layout>
  );
}
