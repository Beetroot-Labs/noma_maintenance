import {
  Autocomplete,
  Box,
  Button,
  Chip,
  LinearProgress,
  Menu,
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
import { getDeviceKindLabel } from "@noma/shared";
import { TriangleAlert } from "lucide-react";
import { MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { CachedDeviceListItem } from "../lib/offlineCache";
import {
  DeviceColumnFilterState,
  DeviceFilterKey,
  emptyDeviceColumnFilters,
} from "../lib/deviceTableFilters";

const tableColumns: Array<{ key: DeviceFilterKey; label: string }> = [
  { key: "code", label: "Kód" },
  { key: "wing", label: "Szárny" },
  { key: "floor", label: "Emelet" },
  { key: "room", label: "Helyiség" },
  { key: "locationDescription", label: "Hely leírása" },
  { key: "kind", label: "Eszköz típusa" },
  { key: "originalKind", label: "Eredeti Típus" },
  { key: "brand", label: "Márka" },
  { key: "model", label: "Modell" },
  { key: "sourceDeviceCode", label: "Forrás ID" },
  { key: "additionalInfo", label: "Megjegyzés" },
];

const enumFilterKeys: DeviceFilterKey[] = ["floor", "wing", "kind", "brand"];

const normalizeForFilter = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("hu-HU");

type FilterableDeviceTableProps = {
  rows: CachedDeviceListItem[];
  isLoading?: boolean;
  loadingText?: string;
  emptyRowsText?: string;
  emptyFilteredRowsText?: string;
  maxHeight?: number | string;
  onRowClick?: (device: CachedDeviceListItem) => void;
  selectedDeviceId?: string | null;
  showMaintainableHighlight?: boolean;
  showFilterSummary?: boolean;
  filters?: DeviceColumnFilterState;
  onFiltersChange?: (next: DeviceColumnFilterState) => void;
  onFilteredRowsChange?: (rows: CachedDeviceListItem[]) => void;
};

export function FilterableDeviceTable({
  rows,
  isLoading = false,
  loadingText = "Offline eszközlista betöltése...",
  emptyRowsText = "Nincs betöltött eszköz a helyi gyorsítótárban.",
  emptyFilteredRowsText = "Nincs a megadott szűrésnek megfelelő eszköz.",
  maxHeight = "calc(100vh - 230px)",
  onRowClick,
  selectedDeviceId = null,
  showMaintainableHighlight = true,
  showFilterSummary = true,
  filters,
  onFiltersChange,
  onFilteredRowsChange,
}: FilterableDeviceTableProps) {
  const [internalFilters, setInternalFilters] =
    useState<DeviceColumnFilterState>(emptyDeviceColumnFilters);
  const [activeFilterKey, setActiveFilterKey] = useState<DeviceFilterKey | null>(null);
  const [filterMenuAnchor, setFilterMenuAnchor] = useState<HTMLElement | null>(null);
  const [pendingTextFilter, setPendingTextFilter] = useState("");
  const filterInputRef = useRef<HTMLInputElement | null>(null);

  const columnFilters = filters ?? internalFilters;

  const setColumnFilters = (updater: DeviceColumnFilterState | ((current: DeviceColumnFilterState) => DeviceColumnFilterState)) => {
    const nextFilters =
      typeof updater === "function"
        ? updater(columnFilters)
        : updater;

    if (filters) {
      onFiltersChange?.(nextFilters);
      return;
    }

    setInternalFilters(nextFilters);
    onFiltersChange?.(nextFilters);
  };

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

  const filteredRows = useMemo(
    () =>
      rows
        .filter((device) =>
          tableColumns.every(({ key }) => {
            const filterValue = normalizeForFilter(columnFilters[key].trim());
            if (!filterValue) {
              return true;
            }

            const cellValue =
              key === "kind"
                ? getDeviceKindLabel(device.kind)
                : (device[key] ?? "-");

            const normalizedCellValue = normalizeForFilter(String(cellValue));
            return enumFilterKeys.includes(key)
              ? normalizedCellValue === filterValue
              : normalizedCellValue.includes(filterValue);
          }),
        )
        .sort((a, b) => {
          const nullLast = (val: string | null | undefined) => (val == null || val === "" ? 1 : 0);

          const wingA = a.wing ?? null;
          const wingB = b.wing ?? null;
          if (nullLast(wingA) !== nullLast(wingB)) {
            return nullLast(wingA) - nullLast(wingB);
          }
          const wingCmp = (wingA ?? "").localeCompare(wingB ?? "", "hu-HU");
          if (wingCmp !== 0) {
            return wingCmp;
          }

          const floorA = a.floor ?? null;
          const floorB = b.floor ?? null;
          if (nullLast(floorA) !== nullLast(floorB)) {
            return nullLast(floorA) - nullLast(floorB);
          }
          const floorStartsWithNumber = (f: string | null) => f != null && /^\d/.test(f);
          const aNum = floorStartsWithNumber(floorA) ? 0 : 1;
          const bNum = floorStartsWithNumber(floorB) ? 0 : 1;
          if (aNum !== bNum) {
            return aNum - bNum;
          }
          const floorCmp = (floorA ?? "").localeCompare(floorB ?? "", "hu-HU", { numeric: true });
          if (floorCmp !== 0) {
            return floorCmp;
          }

          const roomA = a.room ?? null;
          const roomB = b.room ?? null;
          if (nullLast(roomA) !== nullLast(roomB)) {
            return nullLast(roomA) - nullLast(roomB);
          }
          return (roomA ?? "").localeCompare(roomB ?? "", "hu-HU");
        }),
    [columnFilters, rows],
  );

  useEffect(() => {
    onFilteredRowsChange?.(filteredRows);
  }, [filteredRows, onFilteredRowsChange]);

  const activeFilterEntries = Object.entries(columnFilters).filter(([, value]) => value.trim() !== "") as Array<[DeviceFilterKey, string]>;

  const enumFilterOptions: Record<DeviceFilterKey, string[]> = {
    code: [],
    floor: Array.from(new Set(rows.map((device) => device.floor).filter((value): value is string => Boolean(value)))).sort(
      (left, right) => left.localeCompare(right, "hu-HU"),
    ),
    wing: Array.from(new Set(rows.map((device) => device.wing).filter((value): value is string => Boolean(value)))).sort(
      (left, right) => left.localeCompare(right, "hu-HU"),
    ),
    room: [],
    locationDescription: [],
    kind: Array.from(new Set(rows.map((device) => getDeviceKindLabel(device.kind)))).sort((left, right) =>
      left.localeCompare(right, "hu-HU"),
    ),
    originalKind: [],
    brand: Array.from(new Set(rows.map((device) => device.brand).filter((value): value is string => Boolean(value)))).sort(
      (left, right) => left.localeCompare(right, "hu-HU"),
    ),
    model: [],
    sourceDeviceCode: [],
    additionalInfo: [],
  };

  const handleOpenFilterMenu = (event: MouseEvent<HTMLElement>, key: DeviceFilterKey) => {
    setActiveFilterKey(key);
    setFilterMenuAnchor(event.currentTarget);
    if (!enumFilterKeys.includes(key)) {
      setPendingTextFilter(columnFilters[key] ?? "");
    }
  };

  const handleCloseFilterMenu = () => {
    setActiveFilterKey(null);
    setFilterMenuAnchor(null);
    setPendingTextFilter("");
  };

  const handleFilterChange = (key: DeviceFilterKey, value: string) => {
    if (enumFilterKeys.includes(key)) {
      setColumnFilters((current) => ({
        ...current,
        [key]: value,
      }));
    } else {
      setPendingTextFilter(value);
    }
  };

  const commitTextFilter = (key: DeviceFilterKey, value: string) => {
    setColumnFilters((current) => ({
      ...current,
      [key]: value.trim(),
    }));
  };

  const handleClearFilter = (key: DeviceFilterKey) => {
    setColumnFilters((current) => ({
      ...current,
      [key]: "",
    }));
    setPendingTextFilter("");
    handleCloseFilterMenu();
  };

  const handleClearAllFilters = () => {
    setColumnFilters(emptyDeviceColumnFilters);
    handleCloseFilterMenu();
  };

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

  return (
    <>
      {showFilterSummary && activeFilterEntries.length > 0 && (
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
                  onDelete={() => handleClearFilter(key)}
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
        {isLoading ? (
          <Box sx={{ px: 2, py: 3 }}>
            <Stack spacing={1.25}>
              <Typography variant="body2" color="text.secondary">
                {loadingText}
              </Typography>
              <LinearProgress color="secondary" />
            </Stack>
          </Box>
        ) : (
          <TableContainer sx={{ maxHeight }}>
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
                {filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={tableColumns.length} sx={{ py: 4, textAlign: "center", color: "text.secondary" }}>
                      {rows.length === 0 ? emptyRowsText : emptyFilteredRowsText}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRows.map((device) => {
                    const isSelected = selectedDeviceId === device.id;
                    const showMaintenanceWarning =
                      showMaintainableHighlight && !device.isMaintainable && !isSelected;

                    return (
                      <TableRow
                        key={device.id}
                        hover={Boolean(onRowClick)}
                        onClick={onRowClick ? () => onRowClick(device) : undefined}
                        sx={{
                          cursor: onRowClick ? "pointer" : "default",
                          ...(showMaintenanceWarning
                            ? {
                                backgroundColor: "rgba(211, 47, 47, 0.06)",
                                "&.MuiTableRow-hover:hover": {
                                  backgroundColor: "rgba(211, 47, 47, 0.12)",
                                },
                              }
                            : {}),
                          ...(isSelected
                            ? {
                                backgroundColor: "rgba(202, 171, 106, 0.18)",
                                "&.MuiTableRow-hover:hover": {
                                  backgroundColor: "rgba(202, 171, 106, 0.28)",
                                },
                              }
                            : {}),
                        }}
                      >
                        <TableCell>{renderBarcodeCell(device)}</TableCell>
                        <TableCell>{device.wing ?? "-"}</TableCell>
                        <TableCell>{device.floor ?? "-"}</TableCell>
                        <TableCell>{device.room ?? "-"}</TableCell>
                        <TableCell>{device.locationDescription ?? "-"}</TableCell>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>
                          {getDeviceKindLabel(device.kind)}
                        </TableCell>
                        <TableCell>{device.originalKind ?? "-"}</TableCell>
                        <TableCell>{device.brand ?? "-"}</TableCell>
                        <TableCell>{device.model ?? "-"}</TableCell>
                        <TableCell>{device.sourceDeviceCode ?? "-"}</TableCell>
                        <TableCell>{device.additionalInfo ?? "-"}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

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
                ? columnFilters[activeFilterKey].trim() !== ""
                : pendingTextFilter.trim() !== "" || columnFilters[activeFilterKey].trim() !== ""
              ) && (
                <Button color="error" onClick={() => handleClearFilter(activeFilterKey)}>
                  Szűrő törlése
                </Button>
              )}
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
        )}
      </Menu>
    </>
  );
}
