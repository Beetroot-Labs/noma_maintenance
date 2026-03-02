import {
  Box,
  Button,
  CardContent,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  SelectChangeEvent,
  Stack,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { useAuth } from "@noma/shared";
import LoginPage from "./LoginPage";
import { LabelingAppBar } from "./components/LabelingAppBar";
import { LabelingBottomNav } from "./components/LabelingBottomNav";
import {
  BuildingCachePayload,
  CachedBuilding,
  cacheBuildingData,
  getSelectedCachedBuilding,
  hasOfflineCache,
} from "./lib/offlineCache";

const features = [
  "Belépés és jogosultságkezelés",
  "Vonalkód beolvasás vagy kézi megadás",
  "Gyors eszköz-azonosítás",
  "Új barcode hozzárendelés",
  "Eszközfotó feltöltés",
];

type LabelingHomeProps = {
  googleClientId: string;
};

export function LabelingHome({ googleClientId }: LabelingHomeProps) {
  const { user, clearUser, isHydrated } = useAuth();
  const [cacheDialogOpen, setCacheDialogOpen] = useState(false);
  const [availableBuildings, setAvailableBuildings] = useState<CachedBuilding[]>([]);
  const [selectedBuildingId, setSelectedBuildingId] = useState("");
  const [selectedBuildingName, setSelectedBuildingName] = useState<string | null>(null);
  const [isLoadingBuildings, setIsLoadingBuildings] = useState(false);
  const [isPreparingCache, setIsPreparingCache] = useState(false);
  const [cacheError, setCacheError] = useState<string | null>(null);
  const hasCachedBuilding = Boolean(selectedBuildingName);

  const loadBuildingOptions = async () => {
    const response = await fetch("/api/labeling/buildings", {
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error("Nem sikerült betölteni az épületeket.");
    }

    const payload = (await response.json()) as CachedBuilding[];
    setAvailableBuildings(payload);
    return payload;
  };

  useEffect(() => {
    if (!user) {
      return;
    }

    let cancelled = false;

    const prepareCacheSelection = async () => {
      const cacheExists = await hasOfflineCache();
      if (cancelled) {
        return;
      }

      if (cacheExists) {
        const selectedBuilding = await getSelectedCachedBuilding();
        if (!cancelled) {
          setSelectedBuildingId(selectedBuilding?.id ?? "");
          setSelectedBuildingName(selectedBuilding?.name ?? null);
        }
        return;
      }

      setIsLoadingBuildings(true);
      setCacheError(null);

      try {
        const payload = await loadBuildingOptions();
        if (cancelled) {
          return;
        }

        setSelectedBuildingId(payload[0]?.id ?? "");
        setCacheDialogOpen(true);
      } catch (error) {
        if (!cancelled) {
          setCacheError(
            error instanceof Error
              ? error.message
              : "Nem sikerült előkészíteni a helyi gyorsítótárat.",
          );
          setCacheDialogOpen(true);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingBuildings(false);
        }
      }
    };

    void prepareCacheSelection();

    return () => {
      cancelled = true;
    };
  }, [user]);

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

  const handleBuildingChange = (event: SelectChangeEvent<string>) => {
    setSelectedBuildingId(event.target.value);
  };

  const handlePrepareCache = async () => {
    if (!selectedBuildingId) {
      return;
    }

    setIsPreparingCache(true);
    setCacheError(null);

    try {
      const response = await fetch(`/api/labeling/buildings/${selectedBuildingId}/cache`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Nem sikerült letölteni az offline adatokat.");
      }

      const payload = (await response.json()) as BuildingCachePayload;
      await cacheBuildingData(payload, selectedBuildingId);
      setSelectedBuildingName(payload.building.name);
      setCacheDialogOpen(false);
    } catch (error) {
      setCacheError(
        error instanceof Error ? error.message : "Nem sikerült elkészíteni a helyi gyorsítótárat.",
      );
    } finally {
      setIsPreparingCache(false);
    }
  };

  const handleOpenBuildingSelector = async () => {
    setCacheError(null);
    setIsLoadingBuildings(true);
    setCacheDialogOpen(true);

    try {
      const payload = await loadBuildingOptions();
      if (!selectedBuildingId && payload[0]?.id) {
        setSelectedBuildingId(payload[0].id);
      }
    } catch (error) {
      setCacheError(
        error instanceof Error ? error.message : "Nem sikerült betölteni az épületeket.",
      );
    } finally {
      setIsLoadingBuildings(false);
    }
  };

  const handleCloseCacheDialog = () => {
    if (!hasCachedBuilding || isPreparingCache) {
      return;
    }

    setCacheDialogOpen(false);
    setCacheError(null);
  };

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
        buildingName={selectedBuildingName}
        onBuildingClick={() => void handleOpenBuildingSelector()}
        onLogout={async () => {
          await clearUser();
        }}
      />

      <Dialog
        open={cacheDialogOpen}
        fullWidth
        maxWidth="xs"
        onClose={hasCachedBuilding ? handleCloseCacheDialog : undefined}
        disableEscapeKeyDown={!hasCachedBuilding}
        PaperProps={{ sx: { borderRadius: "5px" } }}
      >
        <DialogTitle>Offline adatok előkészítése</DialogTitle>
        <DialogContent sx={{ pt: 1, pb: 3 }}>
          <Stack spacing={2.5}>
            <Typography color="text.secondary">
              Válassza ki azt az épületet, ahol most megkezdi az eszközök címkézését.
            </Typography>

            {isPreparingCache ? (
              <Stack spacing={1.25}>
                <Typography variant="body2" color="text.secondary">
                  Helyi gyorsítótár építése...
                </Typography>
                <LinearProgress color="secondary" />
              </Stack>
            ) : (
              <FormControl fullWidth disabled={isLoadingBuildings || availableBuildings.length === 0}>
                <InputLabel id="building-select-label">Épület</InputLabel>
                <Select
                  labelId="building-select-label"
                  value={selectedBuildingId}
                  label="Épület"
                  onChange={handleBuildingChange}
                >
                  {availableBuildings.map((building) => (
                    <MenuItem key={building.id} value={building.id}>
                      <Stack spacing={0.25}>
                        <Typography>{building.name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {building.address}
                        </Typography>
                      </Stack>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            {cacheError && (
              <Typography variant="body2" color="error.main">
                {cacheError}
              </Typography>
            )}

            {!isPreparingCache && (
              <Stack direction="row" spacing={1.5} justifyContent="flex-end">
                {hasCachedBuilding && (
                  <Button variant="text" color="inherit" onClick={handleCloseCacheDialog}>
                    Mégse
                  </Button>
                )}
                <Button
                  variant="outlined"
                  color="secondary"
                  disabled={!selectedBuildingId || isLoadingBuildings}
                  onClick={() => void handlePrepareCache()}
                >
                  Épület kiválasztása
                </Button>
              </Stack>
            )}
          </Stack>
        </DialogContent>
      </Dialog>

      <Box
        sx={{
          flex: 1,
          width: "min(920px, 100%)",
          mx: "auto",
          px: 2,
          py: 2,
          pb: "calc(96px + env(safe-area-inset-bottom))",
        }}
      >
        <Stack spacing={2}>
          <Paper
            sx={{
              borderRadius: "5px",
              overflow: "hidden",
              border: "1px solid",
              borderColor: "divider",
              background: "background.paper",
            }}
          >
            <CardContent sx={{ p: 3 }}>
              <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: "wrap" }}>
                <Chip label="Mobil fókusz" color="primary" variant="filled" />
                <Chip label="Google bejelentkezés" color="secondary" />
                <Chip label="Belső használat" variant="outlined" />
              </Stack>
              <Typography variant="h2" sx={{ mb: 1 }}>
                Mai állapot
              </Typography>
              <Typography color="text.secondary">
                A következő képernyők a vonalkódolvasásra, az eszközkeresésre és az új címke
                hozzárendelésére lesznek optimalizálva.
              </Typography>
            </CardContent>
          </Paper>

          <Paper
            sx={{
              borderRadius: "5px",
              overflow: "hidden",
              border: "1px solid",
              borderColor: "divider",
              background: "background.paper",
            }}
          >
            <CardContent sx={{ p: 0 }}>
              <Box sx={{ px: 3, py: 2.25 }}>
                <Typography variant="h2">Következő funkciók</Typography>
              </Box>
              <Divider />
              <Stack>
                {features.map((feature, index) => (
                  <Box
                    key={feature}
                    sx={{
                      px: 3,
                      py: 2,
                      borderTop: index === 0 ? "none" : "1px solid rgba(58, 120, 93, 0.12)",
                    }}
                  >
                    <Typography>{feature}</Typography>
                  </Box>
                ))}
              </Stack>
            </CardContent>
          </Paper>
        </Stack>
      </Box>

      <LabelingBottomNav />
    </Box>
  );
}
