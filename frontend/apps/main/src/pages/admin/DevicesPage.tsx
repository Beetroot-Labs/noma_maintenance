import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { getDeviceKindLabel } from "@noma/shared";
import { ArrowDownNarrowWide, ArrowUpWideNarrow, DiamondMinus, X } from "lucide-react";
import { MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { getAdminDevicesStateStorageKey } from "@/lib/adminDevicesState";

type AdminBuilding = {
  id: string;
  name: string;
  address: string;
};

type AdminDeviceRow = {
  device_id: string;
  barcode: string | null;
  building_name: string;
  wing: string | null;
  floor: string | null;
  room: string | null;
  kind: string;
  original_kind: string | null;
  brand: string | null;
  model: string | null;
  source_device_code: string | null;
  latest_maintenance_at: string | null;
};

type AdminDevicesPayload = {
  selected_building_name: string;
  rows: AdminDeviceRow[];
  total_count: number;
  page: number;
  page_size: number;
};

type DeviceFilterKey =
  | "barcode"
  | "wingOrBuilding"
  | "floor"
  | "room"
  | "deviceType"
  | "brandModel"
  | "identifier"
  | "maintainedAt";

type DeviceFilterState = Record<DeviceFilterKey, string>;
type PresenceMode = "missing" | "present" | null;
type DevicePresenceFilterState = Record<DeviceFilterKey, PresenceMode>;
type SortDirection = "asc" | "desc";

const emptyFilters: DeviceFilterState = {
  barcode: "",
  wingOrBuilding: "",
  floor: "",
  room: "",
  deviceType: "",
  brandModel: "",
  identifier: "",
  maintainedAt: "",
};

const emptyPresenceFilters: DevicePresenceFilterState = {
  barcode: null,
  wingOrBuilding: null,
  floor: null,
  room: null,
  deviceType: null,
  brandModel: null,
  identifier: null,
  maintainedAt: null,
};

const tableColumns: Array<{ key: DeviceFilterKey; label: string }> = [
  { key: "barcode", label: "Vonalkód" },
  { key: "wingOrBuilding", label: "Szárny/Épület" },
  { key: "floor", label: "Szint" },
  { key: "room", label: "Szoba" },
  { key: "deviceType", label: "Típus" },
  { key: "brandModel", label: "Márka / Modell" },
  { key: "identifier", label: "Azonosító" },
  { key: "maintainedAt", label: "Karbantartva" },
];

const pageSize = 100;
const devicesStateStorageKey = getAdminDevicesStateStorageKey();
const presenceFilterKeys: DeviceFilterKey[] = ["barcode", "floor", "room", "brandModel", "identifier", "maintainedAt"];

const readApiErrorMessage = async (response: Response, fallback: string) => {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // Ignore malformed payloads.
  }
  return fallback;
};

const formatDate = (value: string | null) => {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat("hu-HU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
};

const renderNullableValue = (value: string | null) => {
  if (!value || !value.trim()) {
    return (
      <Typography component="span" variant="body2" color="text.secondary">
        N/A
      </Typography>
    );
  }

  return value;
};

const getRowDeviceType = (row: AdminDeviceRow) => row.original_kind?.trim() || getDeviceKindLabel(row.kind) || row.kind;
const getRowWingOrBuilding = (row: AdminDeviceRow) => row.wing?.trim() || row.building_name || null;
const getRowBrandModel = (row: AdminDeviceRow) => {
  const parts = [row.brand?.trim(), row.model?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : null;
};

const supportsPresenceFilter = (key: DeviceFilterKey) => presenceFilterKeys.includes(key);

export default function DevicesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [buildings, setBuildings] = useState<AdminBuilding[]>([]);
  const [selectedBuildingName, setSelectedBuildingName] = useState<string | null>(null);
  const [rows, setRows] = useState<AdminDeviceRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoadingBuildings, setIsLoadingBuildings] = useState(false);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buildingDialogError, setBuildingDialogError] = useState<string | null>(null);
  const [buildingDialogOpen, setBuildingDialogOpen] = useState(false);
  const [searchInitialized, setSearchInitialized] = useState(false);
  const [activeFilterKey, setActiveFilterKey] = useState<DeviceFilterKey | null>(null);
  const [filterMenuAnchor, setFilterMenuAnchor] = useState<HTMLElement | null>(null);
  const [pendingTextFilter, setPendingTextFilter] = useState("");
  const filterInputRef = useRef<HTMLInputElement | null>(null);

  const queryString = searchParams.toString();

  const selectedBuildingId = useMemo(
    () => searchParams.get("buildingId") ?? "",
    [queryString, searchParams],
  );
  const filters = useMemo(
    () =>
      tableColumns.reduce<DeviceFilterState>((acc, column) => {
        acc[column.key] = searchParams.get(column.key) ?? "";
        return acc;
      }, { ...emptyFilters }),
    [queryString, searchParams],
  );
  const presenceFiltersByKey = useMemo(
    () =>
      tableColumns.reduce<DevicePresenceFilterState>((acc, column) => {
        const explicitPresence = searchParams.get(`${column.key}Presence`);
        if (explicitPresence === "missing" || explicitPresence === "present") {
          acc[column.key] = explicitPresence;
          return acc;
        }

        acc[column.key] = supportsPresenceFilter(column.key) && (searchParams.get(column.key)?.trim() ?? "")
          ? "present"
          : null;
        return acc;
      }, { ...emptyPresenceFilters }),
    [queryString, searchParams],
  );
  const page = useMemo(
    () => Math.max((Number.parseInt(searchParams.get("page") ?? "1", 10) || 1) - 1, 0),
    [queryString, searchParams],
  );
  const sortBy = useMemo(() => {
    const sortByParam = searchParams.get("sortBy");
    return tableColumns.some((column) => column.key === sortByParam)
      ? (sortByParam as DeviceFilterKey)
      : null;
  }, [queryString, searchParams]);
  const sortDir: SortDirection = useMemo(
    () => (searchParams.get("sortDir") === "desc" ? "desc" : "asc"),
    [queryString, searchParams],
  );

  const selectedBuilding = useMemo(
    () => buildings.find((building) => building.id === selectedBuildingId) ?? null,
    [buildings, selectedBuildingId],
  );

  const activeFilterEntries = useMemo(
    () =>
      tableColumns.flatMap((column) => {
        if (presenceFiltersByKey[column.key] === "missing") {
          return [[column.key, `Nincs ${column.label}`] as [DeviceFilterKey, string]];
        }

        const value = filters[column.key].trim();
        if (value) {
          return [[column.key, value] as [DeviceFilterKey, string]];
        }

        if (presenceFiltersByKey[column.key] === "present") {
          return [[column.key, `Van ${column.label}`] as [DeviceFilterKey, string]];
        }

        return [];
      }),
    [filters, presenceFiltersByKey],
  );

  useEffect(() => {
    if (searchInitialized) {
      return;
    }

    if (queryString) {
      setSearchInitialized(true);
      return;
    }

    try {
      const raw = window.sessionStorage.getItem(devicesStateStorageKey);
      if (!raw) {
        setSearchInitialized(true);
        return;
      }

      const stored = JSON.parse(raw) as { search?: string; buildingName?: string | null };
      if (stored.buildingName) {
        setSelectedBuildingName(stored.buildingName);
      }
      if (stored.search) {
        setSearchInitialized(true);
        setSearchParams(stored.search, { replace: true });
        return;
      }
    } catch {
      // Ignore malformed session state.
    }

    setSearchInitialized(true);
  }, [queryString, searchInitialized, searchParams, setSearchParams]);

  useEffect(() => {
    if (!searchInitialized) {
      return;
    }

    if (!queryString) {
      window.sessionStorage.removeItem(devicesStateStorageKey);
      return;
    }

    window.sessionStorage.setItem(
      devicesStateStorageKey,
      JSON.stringify({ search: queryString, buildingName: selectedBuildingName }),
    );
  }, [queryString, searchInitialized, selectedBuildingName]);

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
    if (!selectedBuildingId) {
      setSelectedBuildingName(null);
      setRows([]);
      setTotalCount(0);
      return;
    }

    let cancelled = false;

    const loadDevices = async () => {
      setIsLoadingDevices(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          buildingId: selectedBuildingId,
          page: String(page + 1),
        });

        if (sortBy) {
          params.set("sortBy", sortBy);
          params.set("sortDir", sortDir);
        }

        tableColumns.forEach((column) => {
          const value = filters[column.key].trim();
          if (value) {
            params.set(column.key, value);
          }
          const presence = presenceFiltersByKey[column.key];
          if (presence === "missing") {
            params.set(`${column.key}Presence`, "missing");
          } else if (presence === "present" && !value) {
            params.set(`${column.key}Presence`, "present");
          }
        });

        const response = await fetch(`/api/admin/devices?${params.toString()}`, {
          credentials: "include",
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(await readApiErrorMessage(response, "Nem sikerült betölteni a berendezéseket."));
        }

        const payload = (await response.json()) as AdminDevicesPayload;
        if (!cancelled) {
          setSelectedBuildingName(payload.selected_building_name);
          setRows(payload.rows);
          setTotalCount(payload.total_count);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Nem sikerült betölteni a berendezéseket.");
          setRows([]);
          setTotalCount(0);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingDevices(false);
        }
      }
    };

    void loadDevices();
    return () => {
      cancelled = true;
    };
  }, [filters, page, presenceFiltersByKey, selectedBuildingId, sortBy, sortDir]);

  const updateSearchParams = (mutate: (next: URLSearchParams) => void) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      mutate(next);

      if (next.get("page") === "1") {
        next.delete("page");
      }
      if (!next.get("sortBy")) {
        next.delete("sortDir");
      }
      if (!next.get("buildingId")) {
        next.delete("buildingId");
      }

      tableColumns.forEach((column) => {
        const value = next.get(column.key)?.trim() ?? "";
        if (!value) {
          next.delete(column.key);
        }
        const presence = next.get(`${column.key}Presence`);
        if (presence !== "missing" && !(presence === "present" && !value)) {
          next.delete(`${column.key}Presence`);
        }
      });

      return next;
    }, { replace: true });
  };

  const openBuildingDialog = async () => {
    setBuildingDialogOpen(true);
    setIsLoadingBuildings(true);
    setBuildingDialogError(null);

    try {
      const response = await fetch("/api/admin/buildings", {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, "Nem sikerült betölteni az épületeket."));
      }

      const payload = (await response.json()) as AdminBuilding[];
      setBuildings(payload);
    } catch (err) {
      setBuildingDialogError(err instanceof Error ? err.message : "Nem sikerült betölteni az épületeket.");
    } finally {
      setIsLoadingBuildings(false);
    }
  };

  const handleOpenFilterMenu = (event: MouseEvent<HTMLElement>, key: DeviceFilterKey) => {
    setActiveFilterKey(key);
    setFilterMenuAnchor(event.currentTarget);
    setPendingTextFilter(filters[key] ?? "");
  };

  const handleCloseFilterMenu = () => {
    setActiveFilterKey(null);
    setFilterMenuAnchor(null);
    setPendingTextFilter("");
  };

  const commitTextFilter = (key: DeviceFilterKey, value: string) => {
    updateSearchParams((next) => {
      const trimmedValue = value.trim();
      if (trimmedValue) {
        next.set(key, trimmedValue);
        next.delete(`${key}Presence`);
      } else if (supportsPresenceFilter(key)) {
        next.delete(key);
        next.set(`${key}Presence`, "present");
      } else {
        next.delete(key);
      }
      next.set("page", "1");
    });
  };

  const handleClearFilter = (key: DeviceFilterKey) => {
    setPendingTextFilter("");
    updateSearchParams((next) => {
      next.delete(key);
      next.delete(`${key}Presence`);
      next.set("page", "1");
    });
    handleCloseFilterMenu();
  };

  const handleClearAllFilters = () => {
    setPendingTextFilter("");
    updateSearchParams((next) => {
      tableColumns.forEach((column) => {
        next.delete(column.key);
        next.delete(`${column.key}Presence`);
      });
      next.set("page", "1");
    });
    handleCloseFilterMenu();
  };

  const handleSetSort = (key: DeviceFilterKey, direction: SortDirection) => {
    updateSearchParams((next) => {
      next.set("sortBy", key);
      next.set("sortDir", direction);
      next.set("page", "1");
    });
  };

  const handleCycleSort = (key: DeviceFilterKey) => {
    if (sortBy !== key) {
      handleSetSort(key, "asc");
      return;
    }

    if (sortDir === "asc") {
      handleSetSort(key, "desc");
      return;
    }

    updateSearchParams((next) => {
      next.delete("sortBy");
      next.delete("sortDir");
      next.set("page", "1");
    });
  };

  const handleSelectBuilding = (buildingId: string) => {
    const building = buildings.find((item) => item.id === buildingId) ?? null;
    setSelectedBuildingName(building?.name ?? null);
    updateSearchParams((next) => {
      next.set("buildingId", buildingId);
      next.set("page", "1");
    });
    setBuildingDialogOpen(false);
  };

  const buildingButtonLabel = selectedBuildingName
    ?? selectedBuilding?.name
    ?? (isLoadingBuildings ? "Épületek betöltése..." : "Épület kiválasztása");
  const showLoadingOverlay = isLoadingDevices && rows.length > 0;
  const showInitialLoadingState = isLoadingDevices && rows.length === 0;

  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5, width: "min(100%, 1480px)" }}>
        <Box
          sx={{
            display: "flex",
            alignItems: { xs: "stretch", md: "center" },
            justifyContent: "space-between",
            gap: 2,
            flexDirection: { xs: "column", md: "row" },
          }}
        >
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 800 }}>
              Berendezések
            </Typography>
          </Box>

          <Stack spacing={0.75} sx={{ minWidth: { md: 420 } }}>
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 700 }}>
              Kiválasztott épület
            </Typography>
            <Button
              variant="outlined"
              color="inherit"
              onClick={() => void openBuildingDialog()}
              disabled={isLoadingBuildings}
              sx={{
                justifyContent: "space-between",
                px: 2,
                py: 1.25,
                textAlign: "left",
                textTransform: "none",
                whiteSpace: "normal",
              }}
            >
              {buildingButtonLabel}
            </Button>
          </Stack>
        </Box>

        {error ? <Alert severity="error">{error}</Alert> : null}

        <Paper
          sx={{
            borderRadius: 3,
            overflow: "hidden",
            border: "1px solid",
            borderColor: "divider",
            background: "background.paper",
          }}
        >
          <Box sx={{ px: 2, py: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
            <Stack
              direction={{ xs: "column", lg: "row" }}
              spacing={1.25}
              justifyContent="space-between"
              alignItems={{ xs: "flex-start", lg: "center" }}
            >
              <Stack spacing={0.25}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  Eszközlista
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {totalCount} berendezés, oldalanként {pageSize} elem
                </Typography>
              </Stack>

              {activeFilterEntries.length > 0 ? (
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    Szűrés aktív
                  </Typography>
                  {activeFilterEntries.map(([key, value]) => {
                    return (
                      <Chip
                        key={key}
                        label={value.startsWith("Nincs ") || value.startsWith("Van ") ? value : `${tableColumns.find((item) => item.key === key)?.label}: ${value}`}
                        size="small"
                        onDelete={() => handleClearFilter(key)}
                      />
                    );
                  })}
                  <Button size="small" color="secondary" onClick={handleClearAllFilters}>
                    Összes szűrő törlése
                  </Button>
                </Stack>
              ) : null}
            </Stack>
          </Box>

          <Box sx={{ position: "relative" }}>
            <TableContainer sx={{ maxHeight: "calc(100vh - 280px)" }}>
              <Table stickyHeader size="small" aria-label="Berendezések">
                <TableHead>
                  <TableRow>
                    {tableColumns.map((column) => {
                      const isFiltered = filters[column.key].trim() !== "" || presenceFiltersByKey[column.key] !== null;
                      const isSorted = sortBy === column.key;
                      const sortIndicator = isSorted ? (sortDir === "asc" ? " ↑" : " ↓") : "";

                      return (
                        <TableCell key={column.key} sx={{ p: 0, whiteSpace: "nowrap" }}>
                          <Button
                            fullWidth
                            color="inherit"
                            onClick={(event) => handleOpenFilterMenu(event, column.key)}
                            sx={{
                              justifyContent: "flex-start",
                              borderRadius: 0,
                              px: 1.5,
                              py: 1.25,
                              color: isFiltered || isSorted ? "secondary.main" : "text.primary",
                              fontWeight: isFiltered || isSorted ? 700 : 600,
                              textTransform: "none",
                            }}
                          >
                            {column.label}{sortIndicator}
                          </Button>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                </TableHead>
                <TableBody sx={{ transition: "opacity 180ms ease", opacity: showLoadingOverlay ? 0.68 : 1 }}>
                  {showInitialLoadingState ? (
                    <TableRow>
                      <TableCell colSpan={tableColumns.length} sx={{ py: 6, textAlign: "center" }}>
                        <CircularProgress color="secondary" />
                      </TableCell>
                    </TableRow>
                  ) : !selectedBuildingId ? (
                    <TableRow>
                      <TableCell colSpan={tableColumns.length} sx={{ py: 4, textAlign: "center", color: "text.secondary" }}>
                        Válasszon ki egy épületet a berendezéslista megjelenítéséhez.
                      </TableCell>
                    </TableRow>
                  ) : rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={tableColumns.length} sx={{ py: 4, textAlign: "center", color: "text.secondary" }}>
                        Nincs a megadott szűrésnek megfelelő berendezés.
                      </TableCell>
                    </TableRow>
                  ) : (
                  rows.map((row) => (
                    <TableRow
                      key={row.device_id}
                      hover
                      onClick={() => navigate(`/admin/devices/${row.device_id}`)}
                      sx={{ cursor: "pointer" }}
                    >
                        <TableCell>{renderNullableValue(row.barcode)}</TableCell>
                        <TableCell>{renderNullableValue(getRowWingOrBuilding(row))}</TableCell>
                        <TableCell>{renderNullableValue(row.floor)}</TableCell>
                        <TableCell>{renderNullableValue(row.room)}</TableCell>
                        <TableCell>{renderNullableValue(getRowDeviceType(row))}</TableCell>
                        <TableCell>{renderNullableValue(getRowBrandModel(row))}</TableCell>
                        <TableCell>{renderNullableValue(row.source_device_code)}</TableCell>
                        <TableCell>{renderNullableValue(formatDate(row.latest_maintenance_at))}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>

            <Box
              sx={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                opacity: showLoadingOverlay ? 1 : 0,
                visibility: showLoadingOverlay ? "visible" : "hidden",
                transition: "opacity 180ms ease, visibility 180ms ease",
                backgroundColor: "rgba(255, 255, 255, 0.28)",
                backdropFilter: showLoadingOverlay ? "blur(1px)" : "none",
                pointerEvents: "none",
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.25,
                  px: 1.75,
                  py: 1,
                  borderRadius: 999,
                  backgroundColor: "rgba(255, 255, 255, 0.88)",
                  boxShadow: "0 12px 28px rgba(15, 23, 42, 0.10)",
                }}
              >
                <CircularProgress size={18} color="secondary" />
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  Frissítés...
                </Typography>
              </Box>
            </Box>
          </Box>

          <TablePagination
            component="div"
            count={totalCount}
            page={page}
            onPageChange={(_, nextPage) => {
              updateSearchParams((next) => {
                next.set("page", String(nextPage + 1));
              });
            }}
            rowsPerPage={pageSize}
            rowsPerPageOptions={[pageSize]}
            labelRowsPerPage="Sorok oldalanként"
          />
        </Paper>

        <Dialog
          open={buildingDialogOpen}
          onClose={() => setBuildingDialogOpen(false)}
          fullWidth
          maxWidth="sm"
          PaperProps={{ sx: { borderRadius: 3 } }}
        >
          <DialogTitle>Épület kiválasztása</DialogTitle>
          <DialogContent sx={{ px: 0, pb: 0 }}>
            {isLoadingBuildings ? (
              <Box sx={{ py: 6, display: "grid", placeItems: "center" }}>
                <CircularProgress color="secondary" />
              </Box>
            ) : buildingDialogError ? (
              <Box sx={{ px: 3, pb: 3 }}>
                <Alert severity="error">{buildingDialogError}</Alert>
              </Box>
            ) : buildings.length === 0 ? (
              <Box sx={{ px: 3, pb: 3 }}>
                <Alert severity="info">Ehhez a tenanthez még nincs elérhető épület.</Alert>
              </Box>
            ) : (
              <List disablePadding>
                {buildings.map((building) => (
                  <ListItemButton
                    key={building.id}
                    selected={building.id === selectedBuildingId}
                    onClick={() => handleSelectBuilding(building.id)}
                  >
                    <ListItemText
                      primary={building.name}
                      secondary={building.address}
                      primaryTypographyProps={{ fontWeight: 700 }}
                    />
                  </ListItemButton>
                ))}
              </List>
            )}
          </DialogContent>
        </Dialog>

        <Menu
          anchorEl={filterMenuAnchor}
          open={Boolean(filterMenuAnchor && activeFilterKey)}
          onClose={handleCloseFilterMenu}
          anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
          transformOrigin={{ vertical: "top", horizontal: "left" }}
          PaperProps={{
            sx: {
              mt: 0.5,
              width: 320,
              maxWidth: "calc(100vw - 32px)",
              borderRadius: 2,
              p: 1.5,
              overflow: "visible",
            },
          }}
        >
          {activeFilterKey ? (
            <Stack spacing={1.5}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {tableColumns.find((column) => column.key === activeFilterKey)?.label}
              </Typography>

              <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 700 }}>
                Rendezés
              </Typography>

              <Button
                variant="text"
                color="inherit"
                onClick={() => handleCycleSort(activeFilterKey)}
                startIcon={
                  sortBy !== activeFilterKey ? (
                    <DiamondMinus size={18} />
                  ) : sortDir === "asc" ? (
                    <ArrowUpWideNarrow size={18} />
                  ) : (
                    <ArrowDownNarrowWide size={18} />
                  )
                }
                sx={{
                  justifyContent: "flex-start",
                  textTransform: "none",
                  px: 1,
                  color: sortBy === activeFilterKey ? "secondary.main" : "text.primary",
                  "&:hover": {
                    backgroundColor: "transparent",
                  },
                }}
              >
                {sortBy !== activeFilterKey ? "Nincs rendezés" : sortDir === "asc" ? "Növekvő" : "Csökkenő"}
              </Button>

              <Divider />

              <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 700 }}>
                Szűrés
              </Typography>

              {supportsPresenceFilter(activeFilterKey) ? (
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <ToggleButtonGroup
                    exclusive
                    color="secondary"
                    value={presenceFiltersByKey[activeFilterKey]}
                    onChange={(_, nextValue: PresenceMode) => {
                      if (!nextValue) {
                        return;
                      }

                      if (nextValue === "missing") {
                        setPendingTextFilter("");
                        updateSearchParams((next) => {
                          next.set(`${activeFilterKey}Presence`, "missing");
                          next.delete(activeFilterKey);
                          next.set("page", "1");
                        });
                        return;
                      }

                      updateSearchParams((next) => {
                        if (filters[activeFilterKey].trim()) {
                          next.delete(`${activeFilterKey}Presence`);
                        } else {
                          next.set(`${activeFilterKey}Presence`, "present");
                        }
                        next.set("page", "1");
                      });
                    }}
                    sx={{ flex: 1 }}
                  >
                    <ToggleButton value="present" sx={{ flex: 1 }}>
                      Van érték
                    </ToggleButton>
                    <ToggleButton value="missing" sx={{ flex: 1 }}>
                      Nincs érték
                    </ToggleButton>
                  </ToggleButtonGroup>
                  {presenceFiltersByKey[activeFilterKey] !== null ? (
                    <IconButton
                      color="error"
                      onClick={() => {
                        setPendingTextFilter("");
                        updateSearchParams((next) => {
                          next.delete(`${activeFilterKey}Presence`);
                          next.delete(activeFilterKey);
                          next.set("page", "1");
                        });
                      }}
                    >
                      <X size={16} />
                    </IconButton>
                  ) : null}
                </Stack>
              ) : null}

              {!supportsPresenceFilter(activeFilterKey) || presenceFiltersByKey[activeFilterKey] === "present" ? (
                <TextField
                  size="small"
                  fullWidth
                  inputRef={filterInputRef}
                  label="Szűrőszöveg"
                  value={pendingTextFilter}
                  onChange={(event) => setPendingTextFilter(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter") {
                      commitTextFilter(activeFilterKey, pendingTextFilter);
                      handleCloseFilterMenu();
                    }
                  }}
                />
              ) : null}

              <Stack direction="row" justifyContent="flex-end">
                <Button
                  color="secondary"
                  onClick={() => {
                    if (!supportsPresenceFilter(activeFilterKey) || presenceFiltersByKey[activeFilterKey] === "present") {
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
    </Layout>
  );
}
