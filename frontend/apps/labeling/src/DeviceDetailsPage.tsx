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
  IconButton,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { Barcode, Camera, Trash2 } from "lucide-react";
import { getDeviceKindLabel, useAuth } from "@noma/shared";
import { ChangeEvent, ReactNode, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import LoginPage from "./LoginPage";
import { LabelingAppBar } from "./components/LabelingAppBar";
import {
  CachedDeviceDetails,
  deleteCachedDevicePhoto,
  getCachedDeviceDetails,
  getSelectedCachedBuilding,
  replaceCachedDevicePhoto,
} from "./lib/offlineCache";

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
  const { user, clearUser, isHydrated } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [buildingName, setBuildingName] = useState<string | null>(null);
  const [device, setDevice] = useState<CachedDeviceDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [cachedPhotoUrl, setCachedPhotoUrl] = useState<string | null>(null);
  const [photoDialogOpen, setPhotoDialogOpen] = useState(false);
  const [isUpdatingPhoto, setIsUpdatingPhoto] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

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
