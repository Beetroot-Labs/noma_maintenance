import { useEffect, useMemo, useRef, useState } from "react";
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
import { useNavigate } from "react-router-dom";
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

const hasSignatureStrokes = (strokes: SignatureStroke[]) =>
  strokes.some((stroke) => stroke.length > 0);

const signatureToPngBlob = async (strokes: SignatureStroke[]) => {
  const canvas = document.createElement("canvas");
  canvas.width = SIGNATURE_EXPORT_WIDTH;
  canvas.height = SIGNATURE_EXPORT_HEIGHT;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Az aláírás képének előállítása nem sikerült.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = appColors.primary;
  context.lineWidth = 6;
  context.lineCap = "round";
  context.lineJoin = "round";

  for (const stroke of strokes) {
    if (stroke.length === 0) {
      continue;
    }

    if (stroke.length === 1) {
      const point = stroke[0];
      context.beginPath();
      context.arc((point.x / 100) * canvas.width, (point.y / 100) * canvas.height, 3, 0, Math.PI * 2);
      context.fillStyle = appColors.primary;
      context.fill();
      continue;
    }

    context.beginPath();
    stroke.forEach((point, index) => {
      const x = (point.x / 100) * canvas.width;
      const y = (point.y / 100) * canvas.height;
      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });
    context.stroke();
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((nextBlob) => resolve(nextBlob), "image/png");
  });

  if (!blob) {
    throw new Error("Az aláírás képének előállítása nem sikerült.");
  }

  return blob;
};

type SignaturePadProps = {
  strokes: SignatureStroke[];
  onChange: (strokes: SignatureStroke[]) => void;
};

function SignaturePad({ strokes, onChange }: SignaturePadProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const currentStrokeRef = useRef<SignatureStroke>([]);
  const [draftStroke, setDraftStroke] = useState<SignatureStroke>([]);

  const toPoint = (clientX: number, clientY: number): SignaturePoint | null => {
    const surface = surfaceRef.current;
    if (!surface) {
      return null;
    }

    const rect = surface.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return null;
    }

    return {
      x: ((clientX - rect.left) / rect.width) * 100,
      y: ((clientY - rect.top) / rect.height) * 100,
    };
  };

  const commitCurrentStroke = () => {
    if (currentStrokeRef.current.length === 0) {
      setDraftStroke([]);
      return;
    }

    onChange([...strokes, currentStrokeRef.current]);
    currentStrokeRef.current = [];
    setDraftStroke([]);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const nextPoint = toPoint(event.clientX, event.clientY);
    if (!nextPoint) {
      return;
    }

    pointerIdRef.current = event.pointerId;
    currentStrokeRef.current = [nextPoint];
    setDraftStroke([nextPoint]);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== event.pointerId) {
      return;
    }

    const nextPoint = toPoint(event.clientX, event.clientY);
    if (!nextPoint) {
      return;
    }

    currentStrokeRef.current = [...currentStrokeRef.current, nextPoint];
    setDraftStroke(currentStrokeRef.current);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== event.pointerId) {
      return;
    }

    commitCurrentStroke();
    pointerIdRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handlePointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== event.pointerId) {
      return;
    }

    commitCurrentStroke();
    pointerIdRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const allStrokes = draftStroke.length > 0 ? [...strokes, draftStroke] : strokes;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
      <Box
        ref={surfaceRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        sx={{
          position: "relative",
          minHeight: 180,
          border: `1px dashed ${appColors.border}`,
          borderRadius: 2,
          bgcolor: "background.paper",
          touchAction: "none",
          overflow: "hidden",
        }}
      >
        {allStrokes.length === 0 ? (
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

        <Box
          component="svg"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          sx={{
            display: "block",
            width: "100%",
            height: 180,
          }}
        >
          {allStrokes.map((stroke, index) => {
            if (stroke.length === 1) {
              const point = stroke[0];
              return <circle key={`point-${index}`} cx={point.x} cy={point.y} r="0.9" fill={appColors.primary} />;
            }

            return (
              <polyline
                key={`stroke-${index}`}
                points={stroke.map((point) => `${point.x},${point.y}`).join(" ")}
                fill="none"
                stroke={appColors.primary}
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}
        </Box>
      </Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 2 }}>
        <Typography variant="caption" color="text.secondary">
          Az aláírás jelenleg csak helyben marad, nem kerül feltöltésre.
        </Typography>
        <Button variant="text" color="inherit" onClick={() => onChange([])}>
          Törlés
        </Button>
      </Box>
    </Box>
  );
}

export default function ShiftSummaryPage() {
  const navigate = useNavigate();
  const { user } = useDemoUser();
  const { currentShift, isLoading: isShiftLoading, refreshCurrentShift } = useShift();
  const [payload, setPayload] = useState<ShiftMaintenanceSummaryPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [referentName, setReferentName] = useState("");
  const [referentRole, setReferentRole] = useState("");
  const [signatureStrokes, setSignatureStrokes] = useState<SignatureStroke[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
  const todayLabel = useMemo(() => formatCurrentDate(new Date()), []);
  const canSubmit =
    referentName.trim().length > 0 &&
    referentRole.trim().length > 0 &&
    hasSignatureStrokes(signatureStrokes) &&
    !isSubmitting;

  const handleCommitShift = async () => {
    if (!currentShift?.id || !isShiftLead) {
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

    if (!hasSignatureStrokes(signatureStrokes)) {
      toast.error("A műszak véglegesítéséhez aláírás szükséges.");
      return;
    }

    setIsSubmitting(true);
    try {
      const signatureBlob = await signatureToPngBlob(signatureStrokes);
      const uploadResponse = await fetch(`/api/shifts/${currentShift.id}/signature-image`, {
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

      const response = await fetch(`/api/shifts/${currentShift.id}/commit`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reference_person_name: referentName.trim(),
          reference_person_role: referentRole.trim(),
          signature_strokes: signatureStrokes,
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
      navigate("/");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Nem sikerült véglegesíteni a műszakot.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

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

                <SignaturePad strokes={signatureStrokes} onChange={setSignatureStrokes} />

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
