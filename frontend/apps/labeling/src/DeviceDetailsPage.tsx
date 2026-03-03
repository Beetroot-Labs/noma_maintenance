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
  Box,
  Button,
  CircularProgress,
  Divider,
  Dialog,
  Fab,
  IconButton,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { Barcode, Camera, ImagePlus, ScanBarcode, Trash2 } from "lucide-react";
import { getDeviceKindLabel, useAuth } from "@noma/shared";
import { ChangeEvent, ReactNode, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import LoginPage from "./LoginPage";
import { LabelingAppBar } from "./components/LabelingAppBar";
import {
  assignCachedDeviceBarcode,
  CachedDeviceDetails,
  deleteCachedDevicePhoto,
  getCachedDeviceDetails,
  getSelectedCachedBuilding,
  replaceCachedDevicePhoto,
} from "./lib/offlineCache";
import { appColors } from "./theme";

type DeviceDetailsPageProps = {
  googleClientId: string;
};

type DetailRowProps = {
  icon: ReactNode;
  label: string;
  value: string;
};

function DetailRow({ icon, label, value }: DetailRowProps) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="flex-start">
      <Box sx={{ color: "secondary.main", mt: "2px" }}>{icon}</Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography>{value}</Typography>
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
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const barcodeVideoRef = useRef<HTMLVideoElement | null>(null);
  const barcodeControlsRef = useRef<{ stop: () => void } | null>(null);

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
      setCachedPhotoUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(device.cachedPhotoBlob);
    setCachedPhotoUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [device]);

  const stopBarcodeScanner = () => {
    barcodeControlsRef.current?.stop();
    barcodeControlsRef.current = null;
    setIsAssigningBarcode(false);
  };

  const startBarcodeScanner = () => {
    if (!barcodeDialogOpen || !barcodeVideoRef.current) {
      return;
    }

    stopBarcodeScanner();
    setBarcodeCameraError(null);
    setIsAssigningBarcode(true);

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]);
    const reader = new BrowserMultiFormatReader(hints, 400);

    reader
      .decodeFromVideoDevice(null, barcodeVideoRef.current, async (result, error, controls) => {
        if (!barcodeDialogOpen) {
          return;
        }

        if (controls && !barcodeControlsRef.current) {
          barcodeControlsRef.current = controls;
          setIsAssigningBarcode(false);
        }

        if (result && id) {
          const scannedCode = result.getText().trim();
          if (!scannedCode) {
            return;
          }

          stopBarcodeScanner();
          setIsAssigningBarcode(true);

          try {
            await assignCachedDeviceBarcode(id, scannedCode);
            await loadDeviceDetails(id);
            setBarcodeDialogOpen(false);
          } catch {
            setBarcodeCameraError("Nem sikerült elmenteni a beolvasott vonalkódot.");
          } finally {
            if (barcodeDialogOpen) {
              setIsAssigningBarcode(false);
            }
          }
        }

        if (error) {
          // Ignore decode misses while scanning.
        }
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
      await replaceCachedDevicePhoto(id);
      await loadDeviceDetails(id);
    } finally {
      setIsUpdatingPhoto(false);
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

      {device && (device.code == null || !cachedPhotoUrl) && (
        <Stack
          spacing={1.25}
          sx={{
            position: "fixed",
            right: 32,
            bottom: "calc(32px + env(safe-area-inset-bottom))",
            zIndex: 1200,
          }}
        >
          {device.code == null && (
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
        fullWidth
        maxWidth="sm"
        PaperProps={{
          sx: {
            borderRadius: "5px",
          },
        }}
      >
        <Box sx={{ px: 3, py: 2.5 }}>
          <Stack spacing={2}>
            <Box>
              <Typography variant="h2">Vonalkód hozzárendelése</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Irányítsd a kamerát a CODE 128 vonalkódra.
              </Typography>
            </Box>

            <Box
              sx={{
                aspectRatio: "16 / 9",
                bgcolor: "grey.900",
                borderRadius: "5px",
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Box
                component="video"
                ref={barcodeVideoRef}
                autoPlay
                playsInline
                disablePictureInPicture
                sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                muted
              />
            </Box>

            {barcodeCameraError && (
              <Typography variant="body2" color="error">
                {barcodeCameraError}
              </Typography>
            )}

            {isAssigningBarcode && !barcodeCameraError && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
                <CircularProgress size={18} color="secondary" />
                <Typography variant="body2" color="text.secondary">
                  Kamera indítása...
                </Typography>
              </Box>
            )}

            <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
              <Button onClick={() => setBarcodeDialogOpen(false)}>Bezárás</Button>
            </Box>
          </Stack>
        </Box>
      </Dialog>

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
