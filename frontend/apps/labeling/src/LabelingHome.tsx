import {
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Menu,
  Paper,
  Select,
  SelectChangeEvent,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getDeviceKindLabel, useAuth } from "@noma/shared";
import { useNavigate } from "react-router-dom";
import LoginPage from "./LoginPage";
import { LabelingAppBar } from "./components/LabelingAppBar";
import {
  BuildingCachePayload,
  CachedBuilding,
  cacheBuildingData,
  clearPendingSyncChanges,
  CachedDeviceListItem,
  getPendingSyncChangesCount,
  getCachedDeviceListItems,
  getSelectedCachedBuilding,
  hasOfflineCache,
  syncPendingBarcodeAssignments,
} from "./lib/offlineCache";

type LabelingHomeProps = {
  googleClientId: string;
};

type FilterKey = "code" | "floor" | "wing" | "room" | "kind" | "brand" | "model";

type ColumnFilterState = Record<FilterKey, string>;

const emptyFilters: ColumnFilterState = {
  code: "",
  floor: "",
  wing: "",
  room: "",
  kind: "",
  brand: "",
  model: "",
};

const tableColumns: Array<{ key: FilterKey; label: string }> = [
  { key: "code", label: "Kód" },
  { key: "floor", label: "Emelet" },
  { key: "wing", label: "Szárny" },
  { key: "room", label: "Helyiség" },
  { key: "kind", label: "Eszköz típusa" },
  { key: "brand", label: "Márka" },
  { key: "model", label: "Modell" },
];

const enumFilterKeys: FilterKey[] = ["floor", "wing", "kind", "brand"];

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
  const { user, clearUser, isHydrated } = useAuth();
  const navigate = useNavigate();
  const [cacheDialogOpen, setCacheDialogOpen] = useState(false);
  const [availableBuildings, setAvailableBuildings] = useState<CachedBuilding[]>([]);
  const [selectedBuildingId, setSelectedBuildingId] = useState("");
  const [selectedBuildingName, setSelectedBuildingName] = useState<string | null>(null);
  const [isLoadingBuildings, setIsLoadingBuildings] = useState(false);
  const [isPreparingCache, setIsPreparingCache] = useState(false);
  const [cacheError, setCacheError] = useState<string | null>(null);
  const [deviceRows, setDeviceRows] = useState<CachedDeviceListItem[]>([]);
  const [isLoadingDeviceRows, setIsLoadingDeviceRows] = useState(false);
  const [columnFilters, setColumnFilters] = useState<ColumnFilterState>(emptyFilters);
  const [activeFilterKey, setActiveFilterKey] = useState<FilterKey | null>(null);
  const [filterMenuAnchor, setFilterMenuAnchor] = useState<HTMLElement | null>(null);
  const [unsyncedWarningOpen, setUnsyncedWarningOpen] = useState(false);
  const [unsyncedChangeCount, setUnsyncedChangeCount] = useState(0);
  const [allowDiscardUnsyncedSwitch, setAllowDiscardUnsyncedSwitch] = useState(false);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
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

  useEffect(() => {
    if (!activeFilterKey || !filterMenuAnchor) {
      return;
    }

    const focusTimer = window.setTimeout(() => {
      filterInputRef.current?.focus();
      filterInputRef.current?.select();
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
    };
  }, [activeFilterKey, filterMenuAnchor]);

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

  const handleOpenFilterMenu = (event: React.MouseEvent<HTMLElement>, key: FilterKey) => {
    setActiveFilterKey(key);
    setFilterMenuAnchor(event.currentTarget);
  };

  const handleCloseFilterMenu = () => {
    setActiveFilterKey(null);
    setFilterMenuAnchor(null);
  };

  const handleFilterChange = (key: FilterKey, value: string) => {
    setColumnFilters((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const handleClearFilter = (key: FilterKey) => {
    setColumnFilters((current) => ({
      ...current,
      [key]: "",
    }));
    handleCloseFilterMenu();
  };

  const handleClearAllFilters = () => {
    setColumnFilters(emptyFilters);
    handleCloseFilterMenu();
  };

  const activeFilterEntries = Object.entries(columnFilters).filter(([, value]) => value.trim() !== "");
  const hasActiveFilters = activeFilterEntries.length > 0;
  const enumFilterOptions: Record<FilterKey, string[]> = {
    code: [],
    floor: Array.from(new Set(deviceRows.map((device) => device.floor).filter((value): value is string => Boolean(value)))).sort(
      (left, right) => left.localeCompare(right, "hu-HU"),
    ),
    wing: Array.from(new Set(deviceRows.map((device) => device.wing).filter((value): value is string => Boolean(value)))).sort(
      (left, right) => left.localeCompare(right, "hu-HU"),
    ),
    room: [],
    kind: Array.from(new Set(deviceRows.map((device) => getDeviceKindLabel(device.kind)))).sort((left, right) =>
      left.localeCompare(right, "hu-HU"),
    ),
    brand: Array.from(new Set(deviceRows.map((device) => device.brand).filter((value): value is string => Boolean(value)))).sort(
      (left, right) => left.localeCompare(right, "hu-HU"),
    ),
    model: [],
  };

  const filteredDeviceRows = deviceRows.filter((device) =>
    tableColumns.every(({ key }) => {
      const filterValue = columnFilters[key].trim().toLocaleLowerCase("hu-HU");
      if (!filterValue) {
        return true;
      }

      const cellValue =
        key === "kind"
          ? getDeviceKindLabel(device.kind)
          : (device[key] ?? "-");

      const normalizedCellValue = String(cellValue).toLocaleLowerCase("hu-HU");
      return enumFilterKeys.includes(key)
        ? normalizedCellValue === filterValue
        : normalizedCellValue.includes(filterValue);
    }),
  );

  const renderBarcodeCell = (device: CachedDeviceListItem) => {
    const hasBarcodeError = device.codeSyncState === "FAILED" && Boolean(device.code);

    return (
      <Box
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.75,
          color: hasBarcodeError ? "error.main" : "text.primary",
        }}
      >
        <Typography
          component="span"
          variant="body2"
          sx={{ color: "inherit", fontWeight: hasBarcodeError ? 700 : 400 }}
        >
          {device.code ?? "-"}
        </Typography>
        {hasBarcodeError ? <TriangleAlert size={16} aria-label="Vonalkód szinkronhiba" /> : null}
      </Box>
    );
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
          <Box sx={{ px: 0.5 }}>
            <Typography variant="h2">Eszközlista</Typography>
          </Box>

          {hasActiveFilters && (
            <Paper
              sx={{
                borderRadius: "5px",
                border: "1px solid",
                borderColor: "divider",
                background: "background.paper",
                px: 1.5,
                py: 1.25,
              }}
            >
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  Szűrés aktív
                </Typography>
                {activeFilterEntries.map(([key, value]) => {
                  const column = tableColumns.find((item) => item.key === key);
                  return (
                    <Chip
                      key={key}
                      label={`${column?.label}: ${value}`}
                      size="small"
                      onDelete={() => handleClearFilter(key as FilterKey)}
                    />
                  );
                })}
                <Button size="small" color="secondary" onClick={handleClearAllFilters}>
                  Összes szűrő törlése
                </Button>
              </Stack>
            </Paper>
          )}

          <Paper
            sx={{
              borderRadius: "5px",
              overflow: "hidden",
              border: "1px solid",
              borderColor: "divider",
              background: "background.paper",
            }}
          >
            {isLoadingDeviceRows ? (
              <Box sx={{ px: 2, py: 3 }}>
                <Stack spacing={1.25}>
                  <Typography variant="body2" color="text.secondary">
                    Offline eszközlista betöltése...
                  </Typography>
                  <LinearProgress color="secondary" />
                </Stack>
              </Box>
            ) : (
              <TableContainer sx={{ maxHeight: "calc(100vh - 230px)" }}>
                <Table stickyHeader size="small" aria-label="Eszközök">
                  <TableHead>
                    <TableRow>
                      {tableColumns.map((column) => {
                        const isFiltered = columnFilters[column.key].trim() !== "";
                        return (
                          <TableCell key={column.key} sx={{ p: 0 }}>
                            <Button
                              fullWidth
                              color="inherit"
                              onClick={(event) => handleOpenFilterMenu(event, column.key)}
                              sx={{
                                justifyContent: "flex-start",
                                borderRadius: 0,
                                px: 1.5,
                                py: 1.25,
                                color: isFiltered ? "secondary.main" : "text.primary",
                                fontWeight: isFiltered ? 700 : 600,
                              }}
                            >
                              {column.label}
                            </Button>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredDeviceRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} sx={{ py: 4, textAlign: "center", color: "text.secondary" }}>
                          {deviceRows.length === 0
                            ? "Nincs betöltött eszköz a helyi gyorsítótárban."
                            : "Nincs a megadott szűrésnek megfelelő eszköz."}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredDeviceRows.map((device) => (
                        <TableRow
                          key={device.id}
                          hover
                          onClick={() => navigate(`/devices/${device.id}`)}
                          sx={{ cursor: "pointer" }}
                        >
                          <TableCell>{renderBarcodeCell(device)}</TableCell>
                          <TableCell>{device.floor ?? "-"}</TableCell>
                          <TableCell>{device.wing ?? "-"}</TableCell>
                          <TableCell>{device.room ?? "-"}</TableCell>
                          <TableCell sx={{ whiteSpace: "nowrap" }}>
                            {getDeviceKindLabel(device.kind)}
                          </TableCell>
                          <TableCell>{device.brand ?? "-"}</TableCell>
                          <TableCell>{device.model ?? "-"}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        </Stack>
      </Box>

      <Menu
        anchorEl={filterMenuAnchor}
        open={Boolean(filterMenuAnchor && activeFilterKey)}
        onClose={handleCloseFilterMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        PaperProps={{
          sx: {
            mt: 0.5,
            width: 280,
            maxWidth: "calc(100vw - 32px)",
            borderRadius: "5px",
            p: 1.5,
            overflow: "visible",
          },
        }}
      >
        {activeFilterKey && (
          <Stack spacing={1.25}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              Szűrés: {tableColumns.find((column) => column.key === activeFilterKey)?.label}
            </Typography>
            {enumFilterKeys.includes(activeFilterKey) ? (
              <Autocomplete
                autoHighlight
                openOnFocus
                disablePortal
                fullWidth
                options={enumFilterOptions[activeFilterKey]}
                value={columnFilters[activeFilterKey] || null}
                onChange={(_, value) => handleFilterChange(activeFilterKey, value ?? "")}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    inputRef={filterInputRef}
                    size="small"
                    label="Választható érték"
                  />
                )}
              />
            ) : (
              <TextField
                size="small"
                fullWidth
                inputRef={filterInputRef}
                label="Szűrőszöveg"
                value={columnFilters[activeFilterKey]}
                onChange={(event) => handleFilterChange(activeFilterKey, event.target.value)}
              />
            )}
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              {columnFilters[activeFilterKey].trim() !== "" && (
                <Button color="error" onClick={() => handleClearFilter(activeFilterKey)}>
                  Szűrő törlése
                </Button>
              )}
              <Button color="secondary" onClick={handleCloseFilterMenu}>
                Kész
              </Button>
            </Stack>
          </Stack>
        )}
      </Menu>
    </Box>
  );
}
