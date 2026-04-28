import {
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Fab,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  SelectChangeEvent,
  Stack,
  Typography,
} from "@mui/material";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@noma/shared";
import { useNavigate, useSearchParams } from "react-router-dom";
import LoginPage from "./LoginPage";
import { FilterableDeviceTable } from "./components/FilterableDeviceTable";
import { LabelingAppBar } from "./components/LabelingAppBar";
import {
  DeviceColumnFilterState,
  emptyDeviceColumnFilters,
} from "./lib/deviceTableFilters";
import {
  BuildingCachePayload,
  CachedBuilding,
  CachedDeviceListItem,
  cacheBuildingData,
  clearPendingSyncChanges,
  getPendingSyncChangesCount,
  getCachedDeviceListItems,
  getSelectedCachedBuilding,
  hasOfflineCache,
  syncPendingBarcodeAssignments,
} from "./lib/offlineCache";
import { clearLastAddedLocation } from "./lib/lastAddedLocation";
import { appColors } from "./theme";

type LabelingHomeProps = {
  googleClientId: string;
};

const readApiErrorMessage = async (response: Response, fallback: string) => {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return `${fallback} (${response.status}): ${payload.error}`;
    }
  } catch {
    // Ignore malformed error payloads.
  }
  return `${fallback} (${response.status})`;
};

export function LabelingHome({ googleClientId }: LabelingHomeProps) {
  const accentFabSx = {
    backgroundColor: appColors.accent,
    color: appColors.accentIcon,
    "&:hover": {
      backgroundColor: "#BE9A54",
    },
  } as const;

  const { user, clearUser, isHydrated } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const columnFilters: DeviceColumnFilterState = {
    code: searchParams.get("code") ?? "",
    floor: searchParams.get("floor") ?? "",
    wing: searchParams.get("wing") ?? "",
    room: searchParams.get("room") ?? "",
    locationDescription: searchParams.get("locationDescription") ?? "",
    kind: searchParams.get("kind") ?? "",
    originalKind: searchParams.get("originalKind") ?? "",
    brand: searchParams.get("brand") ?? "",
    model: searchParams.get("model") ?? "",
    sourceDeviceCode: searchParams.get("sourceDeviceCode") ?? "",
    additionalInfo: searchParams.get("additionalInfo") ?? "",
  };
  const [cacheDialogOpen, setCacheDialogOpen] = useState(false);
  const [availableBuildings, setAvailableBuildings] = useState<CachedBuilding[]>([]);
  const [selectedBuildingId, setSelectedBuildingId] = useState("");
  const [selectedBuildingName, setSelectedBuildingName] = useState<string | null>(null);
  const [isLoadingBuildings, setIsLoadingBuildings] = useState(false);
  const [isPreparingCache, setIsPreparingCache] = useState(false);
  const [cacheError, setCacheError] = useState<string | null>(null);
  const [deviceRows, setDeviceRows] = useState<CachedDeviceListItem[]>([]);
  const [filteredDeviceCount, setFilteredDeviceCount] = useState(0);
  const [isLoadingDeviceRows, setIsLoadingDeviceRows] = useState(false);
  const [unsyncedWarningOpen, setUnsyncedWarningOpen] = useState(false);
  const [unsyncedChangeCount, setUnsyncedChangeCount] = useState(0);
  const [allowDiscardUnsyncedSwitch, setAllowDiscardUnsyncedSwitch] = useState(false);
  const hasCachedBuilding = Boolean(selectedBuildingName);

  const loadBuildingOptions = async () => {
    const response = await fetch("/api/labeling/buildings", {
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error(await readApiErrorMessage(response, "Nem sikerült betölteni az épületeket"));
    }

    const payload = (await response.json()) as CachedBuilding[];
    setAvailableBuildings(payload);
    setSelectedBuildingId((current) => {
      if (payload.some((building) => building.id === current)) {
        return current;
      }
      return payload[0]?.id ?? "";
    });
    return payload;
  };

  const reloadBuildingCache = async (buildingId: string) => {
    const response = await fetch(`/api/labeling/buildings/${buildingId}/cache`, {
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error(
        await readApiErrorMessage(response, "Nem sikerült frissíteni az offline adatokat"),
      );
    }

    const payload = (await response.json()) as BuildingCachePayload;
    await cacheBuildingData(payload, buildingId);
    setSelectedBuildingName(payload.building.name);
    setDeviceRows(await getCachedDeviceListItems());
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
        if (selectedBuilding?.id && !cancelled) {
          try {
            await reloadBuildingCache(selectedBuilding.id);
          } catch {
            // Keep the existing offline cache if refresh fails right after login.
          }
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

  useEffect(() => {
    if (!user || !hasCachedBuilding) {
      setDeviceRows([]);
      return;
    }

    let cancelled = false;

    const loadCachedDevices = async () => {
      setIsLoadingDeviceRows(true);

      try {
        const cachedRows = await getCachedDeviceListItems();
        if (!cancelled) {
          setDeviceRows(cachedRows);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingDeviceRows(false);
        }
      }
    };

    void loadCachedDevices();

    return () => {
      cancelled = true;
    };
  }, [user, hasCachedBuilding, selectedBuildingName]);

  const handleTableFiltersChange = useCallback(
    (nextFilters: DeviceColumnFilterState) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        (Object.keys(emptyDeviceColumnFilters) as Array<keyof DeviceColumnFilterState>).forEach(
          (key) => {
            const value = nextFilters[key].trim();
            if (value) {
              next.set(key, value);
            } else {
              next.delete(key);
            }
          },
        );
        return next;
      }, { replace: true });
    },
    [setSearchParams],
  );

  const handleFilteredRowsChange = useCallback((rows: CachedDeviceListItem[]) => {
    setFilteredDeviceCount(rows.length);
  }, []);

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
      const currentBuilding = await getSelectedCachedBuilding();
      const isSwitchingBuilding = currentBuilding?.id !== selectedBuildingId;
      if (isSwitchingBuilding && allowDiscardUnsyncedSwitch) {
        await clearPendingSyncChanges();
      }

      const response = await fetch(`/api/labeling/buildings/${selectedBuildingId}/cache`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(
          await readApiErrorMessage(response, "Nem sikerült letölteni az offline adatokat"),
        );
      }

      const payload = (await response.json()) as BuildingCachePayload;
      await cacheBuildingData(payload, selectedBuildingId);
      if (isSwitchingBuilding && user) {
        clearLastAddedLocation(user.id);
      }
      setSelectedBuildingName(payload.building.name);
      setDeviceRows(await getCachedDeviceListItems());
      setCacheDialogOpen(false);
      setAllowDiscardUnsyncedSwitch(false);
    } catch (error) {
      setCacheError(
        error instanceof Error ? error.message : "Nem sikerült elkészíteni a helyi gyorsítótárat.",
      );
    } finally {
      setIsPreparingCache(false);
    }
  };

  const handleOpenBuildingSelector = async () => {
    if (hasCachedBuilding) {
      await syncPendingBarcodeAssignments();
      const pendingChanges = await getPendingSyncChangesCount();
      if (pendingChanges > 0) {
        setUnsyncedChangeCount(pendingChanges);
        setUnsyncedWarningOpen(true);
        return;
      }
    }

    setAllowDiscardUnsyncedSwitch(false);
    await openBuildingSelectorDialog();
  };

  const openBuildingSelectorDialog = async () => {
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

  const handleConfirmDiscardUnsyncedChanges = async () => {
    setUnsyncedWarningOpen(false);
    setAllowDiscardUnsyncedSwitch(true);
    await openBuildingSelectorDialog();
  };

  const handleCloseCacheDialog = () => {
    if (!hasCachedBuilding || isPreparingCache) {
      return;
    }

    setCacheDialogOpen(false);
    setCacheError(null);
  };

  const handleSyncStatusClick = async () => {
    const selectedBuilding = await getSelectedCachedBuilding();
    if (!selectedBuilding) {
      return;
    }

    setCacheError(null);
    try {
      await reloadBuildingCache(selectedBuilding.id);
    } catch (error) {
      setCacheError(
        error instanceof Error ? error.message : "Nem sikerült frissíteni az offline adatokat.",
      );
      throw error;
    }
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
        onSyncStatusClick={handleSyncStatusClick}
        onLogout={async () => {
          await clearUser();
        }}
      />

      <Dialog
        open={unsyncedWarningOpen}
        onClose={() => setUnsyncedWarningOpen(false)}
        fullWidth
        maxWidth="xs"
        PaperProps={{ sx: { borderRadius: "5px" } }}
      >
        <DialogTitle>Nem mentett változtatások</DialogTitle>
        <DialogContent sx={{ pt: 1, pb: 3 }}>
          <Stack spacing={2.5}>
            <Typography color="text.secondary">
              {`Van ${unsyncedChangeCount} nem mentett változtatásod a jelenlegi épületben. Ha most átváltasz egy másik épületre, ezek a változtatások elvesznek. Biztosan ezt akarod?`}
            </Typography>
            <Stack direction="row" spacing={1.5} justifyContent="flex-end">
              <Button
                variant="text"
                color="inherit"
                onClick={() => {
                  setUnsyncedWarningOpen(false);
                  setAllowDiscardUnsyncedSwitch(false);
                }}
              >
                Mégse
              </Button>
              <Button
                variant="outlined"
                color="error"
                onClick={() => void handleConfirmDiscardUnsyncedChanges()}
              >
                Igen, eldobom a változásokat
              </Button>
            </Stack>
          </Stack>
        </DialogContent>
      </Dialog>

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
          width: "min(100%, 1120px)",
          mx: "auto",
          px: 2,
          py: 2,
          pb: "calc(24px + env(safe-area-inset-bottom))",
        }}
      >
        <Stack spacing={1.5}>
          <Box
            sx={{
              px: 0.5,
              display: "flex",
              alignItems: "baseline",
              gap: 1.5,
            }}
          >
            <Typography variant="h2">Eszközlista</Typography>
            {deviceRows.length > 0 && (
              <Typography variant="body2" color="text.secondary">
                {filteredDeviceCount}/{deviceRows.length} berendezés megjelenítve
              </Typography>
            )}
          </Box>

          <FilterableDeviceTable
            rows={deviceRows}
            isLoading={isLoadingDeviceRows}
            filters={columnFilters}
            onFiltersChange={handleTableFiltersChange}
            onFilteredRowsChange={handleFilteredRowsChange}
            onRowClick={(device) => navigate(`/devices/${device.id}`)}
          />

        </Stack>
      </Box>

      <Fab
        aria-label="Berendezés hozzáadása"
        onClick={() => navigate("/devices/new")}
        sx={{
          ...accentFabSx,
          position: "fixed",
          right: 32,
          bottom: "calc(32px + env(safe-area-inset-bottom))",
          zIndex: 1200,
        }}
      >
        <Plus size={20} />
      </Fab>
    </Box>
  );
}
