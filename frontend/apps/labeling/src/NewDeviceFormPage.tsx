import { ArrowBackIosNew } from "@mui/icons-material";
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Menu,
  MenuItem,
  Paper,
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
import { deviceKindLabels, useAuth } from "@noma/shared";
import { MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import LoginPage from "./LoginPage";
import { LabelingAppBar } from "./components/LabelingAppBar";
import {
  BuildingCachePayload,
  CachedBuilding,
  CachedLocationListItem,
  cacheBuildingData,
  getCachedLocationListItems,
  getSelectedCachedBuilding,
} from "./lib/offlineCache";
import {
  getLastAddedLocation,
  setLastAddedLocation,
} from "./lib/lastAddedLocation";

type NewDeviceFormPageProps = {
  googleClientId: string;
};

type LocationFilterKey = "wing" | "floor" | "room" | "locationDescription";
type LocationFilterState = Record<LocationFilterKey, string>;

type NewLocationDraft = {
  floor: string;
  wing: string;
  room: string;
  locationDescription: string;
};

type NewDeviceDraft = {
  kind: string;
  brand: string;
  model: string;
  serialNumber: string;
  additionalInfo: string;
};

const emptyLocationFilters: LocationFilterState = {
  wing: "",
  floor: "",
  room: "",
  locationDescription: "",
};

const emptyNewLocationDraft: NewLocationDraft = {
  floor: "",
  wing: "",
  room: "",
  locationDescription: "",
};

const emptyNewDeviceDraft: NewDeviceDraft = {
  kind: "",
  brand: "",
  model: "",
  serialNumber: "",
  additionalInfo: "",
};

const locationTableColumns: Array<{ key: LocationFilterKey; label: string }> = [
  { key: "wing", label: "Szárny" },
  { key: "floor", label: "Emelet" },
  { key: "room", label: "Helyiség" },
  { key: "locationDescription", label: "Hely leírása" },
];

const enumFilterKeys: LocationFilterKey[] = ["floor", "wing"];

const normalizeForFilter = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("hu-HU");

const normalizeOptionalText = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
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

export function NewDeviceFormPage({ googleClientId }: NewDeviceFormPageProps) {
  const { user, clearUser, isHydrated } = useAuth();
  const navigate = useNavigate();
  const [selectedBuilding, setSelectedBuilding] = useState<CachedBuilding | null>(null);
  const [locationRows, setLocationRows] = useState<CachedLocationListItem[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [locationFilters, setLocationFilters] = useState<LocationFilterState>(emptyLocationFilters);
  const [activeFilterKey, setActiveFilterKey] = useState<LocationFilterKey | null>(null);
  const [filterMenuAnchor, setFilterMenuAnchor] = useState<HTMLElement | null>(null);
  const [pendingTextFilter, setPendingTextFilter] = useState("");
  const [addLocationDialogOpen, setAddLocationDialogOpen] = useState(false);
  const [newLocationDraft, setNewLocationDraft] = useState<NewLocationDraft>(emptyNewLocationDraft);
  const [newLocationError, setNewLocationError] = useState<string | null>(null);
  const [isCreatingLocation, setIsCreatingLocation] = useState(false);
  const [deviceDraft, setDeviceDraft] = useState<NewDeviceDraft>(emptyNewDeviceDraft);
  const [createDeviceError, setCreateDeviceError] = useState<string | null>(null);
  const [isCreatingDevice, setIsCreatingDevice] = useState(false);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const locationRowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const [pendingScrollLocationId, setPendingScrollLocationId] = useState<string | null>(null);
  const lastAddedLocation = useMemo(
    () => (user ? getLastAddedLocation(user.id) : null),
    [user, locationRows, selectedBuilding],
  );

  const selectedLocation = useMemo(
    () => locationRows.find((location) => location.id === selectedLocationId) ?? null,
    [locationRows, selectedLocationId],
  );

  const filteredLocationRows = useMemo(
    () =>
      locationRows
        .filter((location) =>
          locationTableColumns.every(({ key }) => {
            const filterValue = normalizeForFilter(locationFilters[key].trim());
            if (!filterValue) {
              return true;
            }

            const cellValue = location[key] ?? "-";
            const normalizedCellValue = normalizeForFilter(String(cellValue));
            return enumFilterKeys.includes(key)
              ? normalizedCellValue === filterValue
              : normalizedCellValue.includes(filterValue);
          }),
        )
        .sort((left, right) => {
          const nullLast = (val: string | null | undefined) => (val == null || val === "" ? 1 : 0);

          if (nullLast(left.wing) !== nullLast(right.wing)) {
            return nullLast(left.wing) - nullLast(right.wing);
          }
          const wingCmp = (left.wing ?? "").localeCompare(right.wing ?? "", "hu-HU");
          if (wingCmp !== 0) {
            return wingCmp;
          }

          if (nullLast(left.floor) !== nullLast(right.floor)) {
            return nullLast(left.floor) - nullLast(right.floor);
          }
          const floorCmp = (left.floor ?? "").localeCompare(right.floor ?? "", "hu-HU", {
            numeric: true,
          });
          if (floorCmp !== 0) {
            return floorCmp;
          }

          if (nullLast(left.room) !== nullLast(right.room)) {
            return nullLast(left.room) - nullLast(right.room);
          }
          const roomCmp = (left.room ?? "").localeCompare(right.room ?? "", "hu-HU", {
            numeric: true,
          });
          if (roomCmp !== 0) {
            return roomCmp;
          }

          return (left.locationDescription ?? "").localeCompare(right.locationDescription ?? "", "hu-HU");
        }),
    [locationRows, locationFilters],
  );

  const activeFilterEntries = useMemo(
    () =>
      (Object.entries(locationFilters) as Array<[LocationFilterKey, string]>).filter(
        ([, value]) => value.trim() !== "",
      ),
    [locationFilters],
  );

  const enumFilterOptions: Record<LocationFilterKey, string[]> = useMemo(
    () => ({
      wing: Array.from(
        new Set(locationRows.map((location) => location.wing).filter((value): value is string => Boolean(value))),
      ).sort((left, right) => left.localeCompare(right, "hu-HU")),
      floor: Array.from(
        new Set(locationRows.map((location) => location.floor).filter((value): value is string => Boolean(value))),
      ).sort((left, right) => left.localeCompare(right, "hu-HU", { numeric: true })),
      room: [],
      locationDescription: [],
    }),
    [locationRows],
  );

  const refreshBuildingCache = async (buildingId: string, preferredLocationId?: string) => {
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

    const cachedLocations = await getCachedLocationListItems(buildingId);
    setSelectedBuilding(payload.building);
    setLocationRows(cachedLocations);
    setSelectedLocationId((current) => {
      if (preferredLocationId && cachedLocations.some((location) => location.id === preferredLocationId)) {
        return preferredLocationId;
      }
      if (current && cachedLocations.some((location) => location.id === current)) {
        return current;
      }
      return "";
    });
  };

  useEffect(() => {
    if (!user) {
      setSelectedBuilding(null);
      setLocationRows([]);
      setSelectedLocationId("");
      return;
    }

    let cancelled = false;

    const loadSelectedBuilding = async () => {
      setIsLoadingLocations(true);
      setPageError(null);

      try {
        const building = await getSelectedCachedBuilding();
        if (cancelled) {
          return;
        }

        if (!building) {
          setSelectedBuilding(null);
          setLocationRows([]);
          setSelectedLocationId("");
          setPageError("Nincs kiválasztott épület. Lépjen vissza az eszközlistához.");
          return;
        }

        const cachedLocations = await getCachedLocationListItems(building.id);
        if (cancelled) {
          return;
        }

        setSelectedBuilding(building);
        setLocationRows(cachedLocations);
        setSelectedLocationId((current) => {
          if (current && cachedLocations.some((location) => location.id === current)) {
            return current;
          }
          return "";
        });
      } catch (error) {
        if (!cancelled) {
          setPageError(
            error instanceof Error
              ? error.message
              : "Nem sikerült betölteni az épülethez tartozó lokációkat.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingLocations(false);
        }
      }
    };

    void loadSelectedBuilding();

    return () => {
      cancelled = true;
    };
  }, [user]);

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

  useEffect(() => {
    if (!pendingScrollLocationId) {
      return;
    }

    const targetRow = locationRowRefs.current[pendingScrollLocationId];
    if (targetRow) {
      targetRow.scrollIntoView({ block: "nearest", behavior: "smooth" });
      setPendingScrollLocationId(null);
      return;
    }

    const clearTimer = window.setTimeout(() => {
      setPendingScrollLocationId(null);
    }, 800);

    return () => {
      window.clearTimeout(clearTimer);
    };
  }, [pendingScrollLocationId, filteredLocationRows]);

  const handleSyncStatusClick = async () => {
    if (!selectedBuilding) {
      return;
    }

    setPageError(null);
    try {
      await refreshBuildingCache(selectedBuilding.id);
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : "Nem sikerült frissíteni az offline adatokat.",
      );
      throw error;
    }
  };

  const handleOpenFilterMenu = (event: MouseEvent<HTMLElement>, key: LocationFilterKey) => {
    setActiveFilterKey(key);
    setFilterMenuAnchor(event.currentTarget);
    if (!enumFilterKeys.includes(key)) {
      setPendingTextFilter(locationFilters[key] ?? "");
    }
  };

  const handleCloseFilterMenu = () => {
    setActiveFilterKey(null);
    setFilterMenuAnchor(null);
    setPendingTextFilter("");
  };

  const commitTextFilter = (key: LocationFilterKey, value: string) => {
    setLocationFilters((prev) => ({
      ...prev,
      [key]: value.trim(),
    }));
  };

  const handleFilterChange = (key: LocationFilterKey, value: string) => {
    if (enumFilterKeys.includes(key)) {
      setLocationFilters((prev) => ({
        ...prev,
        [key]: value,
      }));
      return;
    }
    setPendingTextFilter(value);
  };

  const handleClearFilter = (key: LocationFilterKey) => {
    setLocationFilters((prev) => ({
      ...prev,
      [key]: "",
    }));
    setPendingTextFilter("");
    handleCloseFilterMenu();
  };

  const handleClearAllFilters = () => {
    setLocationFilters({ ...emptyLocationFilters });
    setPendingTextFilter("");
    handleCloseFilterMenu();
  };

  const handleOpenAddLocationDialog = () => {
    setNewLocationError(null);
    setNewLocationDraft({
      floor: locationFilters.floor,
      wing: locationFilters.wing,
      room: "",
      locationDescription: "",
    });
    setAddLocationDialogOpen(true);
  };

  const handleSelectLastAddedLocation = () => {
    if (!selectedBuilding || !lastAddedLocation || lastAddedLocation.buildingId !== selectedBuilding.id) {
      return;
    }

    setLocationFilters({
      ...emptyLocationFilters,
      wing: lastAddedLocation.wing ?? "",
      floor: lastAddedLocation.floor ?? "",
      room: lastAddedLocation.room ?? "",
    });
    setSelectedLocationId(lastAddedLocation.locationId);
    setPendingScrollLocationId(lastAddedLocation.locationId);
  };

  const handleCloseAddLocationDialog = () => {
    if (isCreatingLocation) {
      return;
    }
    setAddLocationDialogOpen(false);
  };

  const handleCreateLocation = async () => {
    if (!selectedBuilding) {
      setNewLocationError("Nincs kiválasztott épület.");
      return;
    }

    if (
      !normalizeOptionalText(newLocationDraft.floor)
      && !normalizeOptionalText(newLocationDraft.wing)
      && !normalizeOptionalText(newLocationDraft.room)
      && !normalizeOptionalText(newLocationDraft.locationDescription)
    ) {
      setNewLocationError("Adjon meg legalább egy lokációs mezőt.");
      return;
    }

    setNewLocationError(null);
    setIsCreatingLocation(true);

    try {
      const response = await fetch(`/api/labeling/buildings/${selectedBuilding.id}/locations`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          floor: normalizeOptionalText(newLocationDraft.floor),
          wing: normalizeOptionalText(newLocationDraft.wing),
          room: normalizeOptionalText(newLocationDraft.room),
          locationDescription: normalizeOptionalText(newLocationDraft.locationDescription),
        }),
      });

      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, "Nem sikerült létrehozni a lokációt"));
      }

      const payload = (await response.json()) as { location_id: string };
      await refreshBuildingCache(selectedBuilding.id, payload.location_id);
      setPendingScrollLocationId(payload.location_id);
      setAddLocationDialogOpen(false);
      setNewLocationDraft(emptyNewLocationDraft);
    } catch (error) {
      setNewLocationError(
        error instanceof Error ? error.message : "Nem sikerült létrehozni a lokációt.",
      );
    } finally {
      setIsCreatingLocation(false);
    }
  };

  const handleCreateDevice = async () => {
    if (!selectedBuilding) {
      setCreateDeviceError("Nincs kiválasztott épület.");
      return;
    }
    if (!selectedLocationId) {
      setCreateDeviceError("Válasszon ki egy lokációt.");
      return;
    }
    if (!deviceDraft.kind.trim()) {
      setCreateDeviceError("Az eszköz típusa kötelező.");
      return;
    }

    setCreateDeviceError(null);
    setIsCreatingDevice(true);

    try {
      const response = await fetch("/api/labeling/devices", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          buildingId: selectedBuilding.id,
          existingLocationId: selectedLocationId,
          kind: deviceDraft.kind.trim(),
          brand: normalizeOptionalText(deviceDraft.brand),
          model: normalizeOptionalText(deviceDraft.model),
          serialNumber: normalizeOptionalText(deviceDraft.serialNumber),
          additionalInfo: normalizeOptionalText(deviceDraft.additionalInfo),
        }),
      });

      if (!response.ok) {
        throw new Error(
          await readApiErrorMessage(response, "Nem sikerült létrehozni a berendezést"),
        );
      }

      const payload = (await response.json()) as { device_id: string; location_id: string };
      await refreshBuildingCache(selectedBuilding.id, payload.location_id);
      if (user && selectedLocation) {
        setLastAddedLocation(user.id, {
          buildingId: selectedBuilding.id,
          locationId: selectedLocation.id,
          floor: selectedLocation.floor,
          wing: selectedLocation.wing,
          room: selectedLocation.room,
        });
      }
      navigate(`/devices/${payload.device_id}`);
    } catch (error) {
      setCreateDeviceError(
        error instanceof Error ? error.message : "Nem sikerült létrehozni a berendezést.",
      );
    } finally {
      setIsCreatingDevice(false);
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
        buildingName={selectedBuilding?.name ?? null}
        onBuildingClick={() => navigate(-1)}
        onSyncStatusClick={handleSyncStatusClick}
        onLogout={async () => {
          await clearUser();
        }}
      />

      <Dialog
        open={addLocationDialogOpen}
        onClose={handleCloseAddLocationDialog}
        fullWidth
        maxWidth="sm"
        PaperProps={{ sx: { borderRadius: "5px" } }}
      >
        <DialogTitle>Új lokáció hozzáadása</DialogTitle>
        <DialogContent sx={{ pt: 1, pb: 3 }}>
          <Stack spacing={2}>
            <Autocomplete
              freeSolo
              options={enumFilterOptions.wing}
              value={newLocationDraft.wing}
              onChange={(_, value) =>
                setNewLocationDraft((prev) => ({
                  ...prev,
                  wing: typeof value === "string" ? value : "",
                }))
              }
              onInputChange={(_, value) =>
                setNewLocationDraft((prev) => ({
                  ...prev,
                  wing: value,
                }))
              }
              renderInput={(params) => <TextField {...params} label="Szárny" size="small" />}
            />

            <Autocomplete
              freeSolo
              options={enumFilterOptions.floor}
              value={newLocationDraft.floor}
              onChange={(_, value) =>
                setNewLocationDraft((prev) => ({
                  ...prev,
                  floor: typeof value === "string" ? value : "",
                }))
              }
              onInputChange={(_, value) =>
                setNewLocationDraft((prev) => ({
                  ...prev,
                  floor: value,
                }))
              }
              renderInput={(params) => <TextField {...params} label="Emelet" size="small" />}
            />

            <TextField
              label="Helyiség"
              size="small"
              value={newLocationDraft.room}
              onChange={(event) =>
                setNewLocationDraft((prev) => ({
                  ...prev,
                  room: event.target.value,
                }))
              }
            />

            <TextField
              label="Hely leírása"
              size="small"
              value={newLocationDraft.locationDescription}
              onChange={(event) =>
                setNewLocationDraft((prev) => ({
                  ...prev,
                  locationDescription: event.target.value,
                }))
              }
              multiline
              minRows={2}
            />

            {newLocationError ? (
              <Typography variant="body2" color="error.main">
                {newLocationError}
              </Typography>
            ) : null}

            {isCreatingLocation ? (
              <Stack direction="row" spacing={1} alignItems="center">
                <CircularProgress size={18} color="secondary" />
                <Typography variant="body2" color="text.secondary">
                  Lokáció létrehozása...
                </Typography>
              </Stack>
            ) : null}

            <Stack direction="row" spacing={1.5} justifyContent="flex-end">
              <Button
                color="inherit"
                onClick={handleCloseAddLocationDialog}
                disabled={isCreatingLocation}
              >
                Mégse
              </Button>
              <Button
                variant="outlined"
                color="secondary"
                onClick={() => void handleCreateLocation()}
                disabled={isCreatingLocation}
                startIcon={isCreatingLocation ? <CircularProgress size={16} color="inherit" /> : null}
              >
                Lokáció hozzáadása
              </Button>
            </Stack>
          </Stack>
        </DialogContent>
      </Dialog>

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
        <Stack spacing={2}>
          <Box sx={{ px: 0.5 }}>
            <Button
              color="inherit"
              startIcon={<ArrowBackIosNew sx={{ fontSize: 16 }} />}
              onClick={() => navigate(-1)}
              sx={{ mb: 1, px: 0, justifyContent: "flex-start" }}
            >
              Vissza az eszközlistához
            </Button>
            <Typography variant="h2">Új berendezés</Typography>
          </Box>

          {pageError ? (
            <Typography variant="body2" color="error.main" sx={{ px: 0.5 }}>
              {pageError}
            </Typography>
          ) : null}

          <Paper
            sx={{
              borderRadius: "5px",
              overflow: "hidden",
              border: "1px solid",
              borderColor: "divider",
              background: "background.paper",
            }}
          >
            <Box sx={{ px: 2, py: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
              <Stack spacing={0.25}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  Lokáció kiválasztása
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {filteredLocationRows.length}/{locationRows.length} lokáció megjelenítve
                </Typography>
              </Stack>
            </Box>

            {activeFilterEntries.length > 0 ? (
              <Box
                sx={{
                  borderBottom: "1px solid",
                  borderColor: "divider",
                  px: 1.5,
                  py: 1.25,
                }}
              >
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    Szűrés aktív
                  </Typography>
                  {activeFilterEntries.map(([key, value]) => {
                    const column = locationTableColumns.find((item) => item.key === key);
                    return (
                      <Chip
                        key={key}
                        label={`${column?.label}: ${value}`}
                        size="small"
                        onDelete={() => handleClearFilter(key)}
                      />
                    );
                  })}
                  <Button size="small" color="secondary" onClick={handleClearAllFilters}>
                    Összes szűrő törlése
                  </Button>
                </Stack>
              </Box>
            ) : null}

            {isLoadingLocations ? (
              <Box sx={{ px: 3, py: 4, display: "grid", placeItems: "center" }}>
                <CircularProgress color="secondary" />
              </Box>
            ) : (
              <TableContainer sx={{ maxHeight: 296 }}>
                <Table stickyHeader size="small" aria-label="Lokációk">
                  <TableHead>
                    <TableRow>
                      {locationTableColumns.map((column) => {
                        const isFiltered = locationFilters[column.key].trim() !== "";
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
                    {filteredLocationRows.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={locationTableColumns.length}
                          sx={{ py: 3, textAlign: "center", color: "text.secondary" }}
                        >
                          Nincs a megadott szűrésnek megfelelő lokáció.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredLocationRows.map((location) => (
                        <TableRow
                          key={location.id}
                          ref={(node) => {
                            locationRowRefs.current[location.id] = node;
                          }}
                          hover
                          selected={selectedLocationId === location.id}
                          onClick={() => setSelectedLocationId(location.id)}
                          sx={{
                            cursor: "pointer",
                            "&.Mui-selected": {
                              backgroundColor: "action.selected",
                            },
                            "&.Mui-selected:hover": {
                              backgroundColor: "action.selected",
                            },
                          }}
                        >
                          <TableCell>{location.wing ?? "-"}</TableCell>
                          <TableCell>{location.floor ?? "-"}</TableCell>
                          <TableCell>{location.room ?? "-"}</TableCell>
                          <TableCell>{location.locationDescription ?? "-"}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>

          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              {selectedLocation
                ? `Kiválasztott lokáció: ${selectedLocation.wing ?? "-"} / ${selectedLocation.floor ?? "-"} / ${selectedLocation.room ?? "-"}`
                : "Nincs kiválasztott lokáció."}
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                color="secondary"
                onClick={handleSelectLastAddedLocation}
                disabled={!selectedBuilding || isLoadingLocations || !lastAddedLocation || lastAddedLocation.buildingId !== selectedBuilding.id}
              >
                Legutóbb hozzáadott lokáció
              </Button>
              <Button
                variant="outlined"
                color="secondary"
                onClick={handleOpenAddLocationDialog}
                disabled={!selectedBuilding || isLoadingLocations}
              >
                Új lokáció hozzáadása
              </Button>
            </Stack>
          </Stack>

          <Paper
            sx={{
              borderRadius: "5px",
              border: "1px solid",
              borderColor: "divider",
              background: "background.paper",
              px: 2,
              py: 2,
            }}
          >
            <Stack spacing={2}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                Berendezés adatai
              </Typography>

              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "1fr",
                    sm: "repeat(2, minmax(0, 1fr))",
                  },
                  gap: 1.5,
                }}
              >
                <TextField
                  select
                  label="Eszköz típusa *"
                  size="small"
                  value={deviceDraft.kind}
                  onChange={(event) =>
                    setDeviceDraft((prev) => ({
                      ...prev,
                      kind: event.target.value,
                    }))
                  }
                  required
                >
                  {Object.entries(deviceKindLabels).map(([value, label]) => (
                    <MenuItem key={value} value={value}>
                      {label}
                    </MenuItem>
                  ))}
                </TextField>

                <TextField
                  label="Márka"
                  size="small"
                  value={deviceDraft.brand}
                  onChange={(event) =>
                    setDeviceDraft((prev) => ({
                      ...prev,
                      brand: event.target.value,
                    }))
                  }
                />

                <TextField
                  label="Modell"
                  size="small"
                  value={deviceDraft.model}
                  onChange={(event) =>
                    setDeviceDraft((prev) => ({
                      ...prev,
                      model: event.target.value,
                    }))
                  }
                />

                <TextField
                  label="Gyári szám"
                  size="small"
                  value={deviceDraft.serialNumber}
                  onChange={(event) =>
                    setDeviceDraft((prev) => ({
                      ...prev,
                      serialNumber: event.target.value,
                    }))
                  }
                />

              </Box>

              <TextField
                label="Megjegyzés"
                size="small"
                value={deviceDraft.additionalInfo}
                onChange={(event) =>
                  setDeviceDraft((prev) => ({
                    ...prev,
                    additionalInfo: event.target.value,
                  }))
                }
                multiline
                minRows={3}
              />

              {createDeviceError ? (
                <Typography variant="body2" color="error.main">
                  {createDeviceError}
                </Typography>
              ) : null}

              <Stack direction="row" justifyContent="flex-end">
                <Button
                  variant="contained"
                  color="secondary"
                  onClick={() => void handleCreateDevice()}
                  disabled={isCreatingDevice}
                  startIcon={isCreatingDevice ? <CircularProgress size={16} color="inherit" /> : null}
                >
                  Berendezés létrehozása
                </Button>
              </Stack>
            </Stack>
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
        {activeFilterKey ? (
          <Stack spacing={1.25}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              Szűrés: {locationTableColumns.find((column) => column.key === activeFilterKey)?.label}
            </Typography>

            {enumFilterKeys.includes(activeFilterKey) ? (
              <Autocomplete
                autoHighlight
                openOnFocus
                disablePortal
                fullWidth
                options={enumFilterOptions[activeFilterKey]}
                value={locationFilters[activeFilterKey] || null}
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
                value={pendingTextFilter}
                onChange={(event) => handleFilterChange(activeFilterKey, event.target.value)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Enter") {
                    commitTextFilter(activeFilterKey, pendingTextFilter);
                    handleCloseFilterMenu();
                  }
                }}
              />
            )}

            <Stack direction="row" spacing={1} justifyContent="flex-end">
              {(enumFilterKeys.includes(activeFilterKey)
                ? locationFilters[activeFilterKey].trim() !== ""
                : pendingTextFilter.trim() !== "" || locationFilters[activeFilterKey].trim() !== ""
              ) ? (
                <Button color="error" onClick={() => handleClearFilter(activeFilterKey)}>
                  Szűrő törlése
                </Button>
              ) : null}

              <Button
                color="secondary"
                onClick={() => {
                  if (!enumFilterKeys.includes(activeFilterKey)) {
                    commitTextFilter(activeFilterKey, pendingTextFilter);
                  }
                  handleCloseFilterMenu();
                }}
              >
                Kész
              </Button>
            </Stack>
          </Stack>
        ) : null}
      </Menu>
    </Box>
  );
}
