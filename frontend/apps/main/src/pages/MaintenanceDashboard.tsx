import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  ClickAwayListener,
  IconButton,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";
import { ClipboardCheck, CloudAlert, CloudCog, CloudUpload } from "lucide-react";
import { WorkCard } from "@/components/WorkCard";
import { Layout } from "@/components/Layout";
import { useDemoUser } from "@/context/DemoUserContext";
import { useMaintenance } from "@/context/MaintenanceContext";
import { useShift } from "@/context/ShiftContext";
import type { MaintenanceWork, MaintenanceWorkSyncState } from "@/types/maintenance";
import { appColors } from "@/theme";

type DashboardTabValue = "mine" | "all";

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
  maintenances: ShiftMaintenanceSummaryRow[];
};

type DashboardMaintenanceRow = ShiftMaintenanceSummaryRow & {
  source: "backend" | "local";
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
  return row.device_additional_info?.trim() || "-";
};

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("hu-HU", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const compareNullableTimestampDesc = (left: number | null, right: number | null) => {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return -1;
  }
  if (right === null) {
    return 1;
  }
  return right - left;
};

const compareWorksByCompletionAndStart = (left: MaintenanceWork, right: MaintenanceWork) => {
  const completionOrder = compareNullableTimestampDesc(
    left.endTime?.getTime() ?? null,
    right.endTime?.getTime() ?? null,
  );
  if (completionOrder !== 0) {
    return completionOrder;
  }

  const startOrder = right.startTime.getTime() - left.startTime.getTime();
  if (startOrder !== 0) {
    return startOrder;
  }

  return right.id.localeCompare(left.id);
};

const getDashboardRowCompletionTime = (row: DashboardMaintenanceRow) =>
  row.finished_at ? new Date(row.finished_at).getTime() : row.aborted_at ? new Date(row.aborted_at).getTime() : null;

const compareDashboardRowsByCompletionAndStart = (
  left: DashboardMaintenanceRow,
  right: DashboardMaintenanceRow,
) => {
  const completionOrder = compareNullableTimestampDesc(
    getDashboardRowCompletionTime(left),
    getDashboardRowCompletionTime(right),
  );
  if (completionOrder !== 0) {
    return completionOrder;
  }

  const startOrder = new Date(right.started_at).getTime() - new Date(left.started_at).getTime();
  if (startOrder !== 0) {
    return startOrder;
  }

  return right.maintenance_id.localeCompare(left.maintenance_id);
};

const toDashboardRow = (work: MaintenanceWork, maintainerName: string): DashboardMaintenanceRow => ({
  maintenance_id: work.id,
  maintainer_user_name: maintainerName,
  maintenance_status: work.status === "completed" ? "FINISHED" : "IN_PROGRESS",
  started_at: work.startTime.toISOString(),
  finished_at: work.endTime?.toISOString() ?? null,
  aborted_at: null,
  malfunction_description: work.isMalfunctioning ? work.notes.trim() || "Hibás eszköz" : null,
  note: work.notes.trim() || null,
  device_id: work.deviceId,
  device_code: work.hvacId,
  device_kind: work.hvacKind,
  device_additional_info: null,
  device_brand: null,
  device_model: work.hvacModel,
  device_serial_number: null,
  source_device_code: work.hvacId,
  building_name: "",
  building_address: work.hvacAddress,
  floor: null,
  wing: null,
  room: null,
  location_description: work.hvacLocation,
  source: "local",
});

const resolveSyncState = (
  row: DashboardMaintenanceRow,
  syncState: MaintenanceWorkSyncState | undefined,
): MaintenanceWorkSyncState => {
  if (syncState) {
    return syncState;
  }

  return {
    status: row.source === "backend" || row.finished_at ? "synced" : "retriable",
    lastError: null,
  };
};

const getSyncPresentation = (syncState: MaintenanceWorkSyncState) => {
  if (syncState.status === "synced") {
    return {
      icon: CloudUpload,
      color: "success.main",
      label: "Backendre feltöltve",
    };
  }

  if (syncState.status === "error") {
    return {
      icon: CloudAlert,
      color: "error.main",
      label: "Szinkron hiba",
    };
  }

  return {
    icon: CloudCog,
    color: "warning.main",
    label: "Szinkronra vár",
  };
};

function ShiftWorkCard({
  row,
  syncState,
  to,
}: {
  row: DashboardMaintenanceRow;
  syncState: MaintenanceWorkSyncState;
  to?: string;
}) {
  const navigate = useNavigate();
  const [isErrorTooltipOpen, setIsErrorTooltipOpen] = useState(false);
  const syncPresentation = getSyncPresentation(syncState);
  const SyncIcon = syncPresentation.icon;
  const isClickable = Boolean(to);
  const endLabel = row.finished_at
    ? formatDateTime(row.finished_at)
    : row.aborted_at
      ? formatDateTime(row.aborted_at)
      : "Folyamatban";

  return (
    <Card
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={to ? () => navigate(to) : undefined}
      onKeyDown={
        to
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                navigate(to);
              }
            }
          : undefined
      }
      sx={{
        boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)",
        transition: "box-shadow 0.2s ease",
        animation: "slideUp 0.3s ease-out",
        cursor: isClickable ? "pointer" : "default",
        "&:hover": isClickable ? { boxShadow: "0 12px 28px rgba(31, 50, 58, 0.2)" } : undefined,
        "&:focus-visible": isClickable
          ? { outline: "none", boxShadow: "0 0 0 3px rgba(2, 50, 45, 0.3)" }
          : undefined,
      }}
    >
      <CardContent sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1 }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2 }}>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {row.device_code ?? row.source_device_code ?? "-"} · {row.device_kind}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {formatBrandModel(row)}
            </Typography>
          </Box>
          <Typography
            variant="caption"
            sx={{
              alignSelf: "flex-start",
              px: 1,
              py: 0.5,
              borderRadius: 999,
              bgcolor: row.finished_at || row.aborted_at ? "rgba(15, 23, 42, 0.06)" : "rgba(217, 119, 6, 0.12)",
              color: row.finished_at || row.aborted_at ? "text.secondary" : "warning.dark",
              fontWeight: 700,
            }}
          >
            {row.finished_at || row.aborted_at ? "Lezárt" : "Folyamatban"}
          </Typography>
        </Box>

        <Typography variant="body2" color="text.secondary">
          Karbantartó: {row.maintainer_user_name}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Indítás: {formatDateTime(row.started_at)}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Befejezés: {endLabel}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Helyszín: {formatLocation(row)}
        </Typography>
        {row.note ? (
          <Box sx={{ mt: 0.5, p: 1, bgcolor: "rgba(0, 0, 0, 0.04)", borderRadius: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              {row.note}
            </Typography>
          </Box>
        ) : null}
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: syncPresentation.color }}>
            <SyncIcon size={16} />
            <Typography variant="body2" sx={{ color: syncPresentation.color }}>
              {syncPresentation.label}
            </Typography>
          </Box>
          {syncState.status === "error" && syncState.lastError ? (
            <ClickAwayListener onClickAway={() => setIsErrorTooltipOpen(false)}>
              <Tooltip
                open={isErrorTooltipOpen}
                title={syncState.lastError}
                placement="top-start"
                arrow
                disableFocusListener
                disableHoverListener
                disableTouchListener
              >
                <IconButton
                  size="small"
                  aria-label="Utolsó szinkronhiba megnyitása"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setIsErrorTooltipOpen((open) => !open);
                  }}
                >
                  <CloudAlert size={16} />
                </IconButton>
              </Tooltip>
            </ClickAwayListener>
          ) : null}
        </Box>
      </CardContent>
    </Card>
  );
}

export default function MaintenanceDashboard() {
  const navigate = useNavigate();
  const { user } = useDemoUser();
  const { todaysWorks, canConfirmShiftClose, workSyncStates } = useMaintenance();
  const { currentShift, refreshCurrentShift } = useShift();
  const [activeTab, setActiveTab] = useState<DashboardTabValue>("mine");
  const [isConfirmingClose, setIsConfirmingClose] = useState(false);
  const [allWorksPayload, setAllWorksPayload] = useState<ShiftMaintenanceSummaryPayload | null>(null);
  const [isLoadingAllWorks, setIsLoadingAllWorks] = useState(false);
  const [allWorksError, setAllWorksError] = useState<string | null>(null);
  const attemptedCloseConfirmRef = useRef<string | null>(null);

  const orderedOwnWorks = useMemo(
    () => [...todaysWorks].sort(compareWorksByCompletionAndStart),
    [todaysWorks],
  );

  const orderedAllWorks = useMemo(() => {
    const backendRows = (allWorksPayload?.maintenances ?? []).map((row) => ({
      ...row,
      source: "backend" as const,
    }));
    const backendIds = new Set(backendRows.map((row) => row.maintenance_id));
    const localOnlyRows = todaysWorks
      .filter((work) => !backendIds.has(work.id))
      .map((work) => toDashboardRow(work, user?.name ?? "Saját munka"));

    return [...backendRows, ...localOnlyRows].sort(compareDashboardRowsByCompletionAndStart);
  }, [allWorksPayload?.maintenances, todaysWorks, user?.name]);

  const isCloseRequested =
    currentShift?.status === "CLOSE_REQUESTED" || currentShift?.status === "READY_TO_COMMIT";
  const canStartNewMaintenance = !isCloseRequested;

  useEffect(() => {
    let cancelled = false;

    const loadAllWorks = async () => {
      if (!currentShift?.id) {
        if (!cancelled) {
          setAllWorksPayload(null);
          setAllWorksError(null);
          setIsLoadingAllWorks(false);
        }
        return;
      }

      setIsLoadingAllWorks(true);
      setAllWorksError(null);
      try {
        const response = await fetch(`/api/shifts/${currentShift.id}/maintenance-summary`, {
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(
            await readApiErrorMessage(response, "Nem sikerült betölteni a műszak karbantartásait."),
          );
        }

        const payload = (await response.json()) as ShiftMaintenanceSummaryPayload;
        if (!cancelled) {
          setAllWorksPayload(payload);
        }
      } catch (error) {
        if (!cancelled) {
          setAllWorksError(
            error instanceof Error ? error.message : "Nem sikerült betölteni a műszak karbantartásait.",
          );
          setAllWorksPayload(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingAllWorks(false);
        }
      }
    };

    void loadAllWorks();
    return () => {
      cancelled = true;
    };
  }, [currentShift?.id]);

  useEffect(() => {
    if (
      !currentShift ||
      !navigator.onLine ||
      !canConfirmShiftClose ||
      currentShift.my_participant_status === "CLOSE_CONFIRMED" ||
      (currentShift.status !== "CLOSE_REQUESTED" && currentShift.status !== "READY_TO_COMMIT")
    ) {
      attemptedCloseConfirmRef.current = null;
      return;
    }

    const requestKey = `${currentShift.id}:${currentShift.status}:${currentShift.my_participant_status}`;
    if (attemptedCloseConfirmRef.current === requestKey || isConfirmingClose) {
      return;
    }

    attemptedCloseConfirmRef.current = requestKey;
    setIsConfirmingClose(true);

    void fetch(`/api/shifts/${currentShift.id}/close-confirm`, {
      method: "POST",
      credentials: "include",
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Nem sikerült megerősíteni a műszak lezárását.");
        }
        await refreshCurrentShift();
      })
      .catch(() => {
        attemptedCloseConfirmRef.current = null;
      })
      .finally(() => {
        setIsConfirmingClose(false);
      });
  }, [canConfirmShiftClose, currentShift, isConfirmingClose, refreshCurrentShift]);

  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {isCloseRequested ? (
          <Alert severity="warning">
            {currentShift?.lead_user_name} lezárta a műszakot. Új karbantartási munka már nem
            indítható!
            {currentShift?.my_participant_status !== "CLOSE_CONFIRMED" && canConfirmShiftClose
              ? " A szinkron megerősítése folyamatban van."
              : null}
          </Alert>
        ) : null}

        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <ClipboardCheck size={18} color={appColors.primary} />
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Karbantartási munkák
            </Typography>
          </Box>

          <Tabs
            value={activeTab}
            onChange={(_, value: DashboardTabValue) => setActiveTab(value)}
            variant="fullWidth"
            sx={{
              bgcolor: appColors.card,
              borderRadius: 3,
              border: `1px solid ${appColors.border}`,
              px: 0.5,
            }}
          >
            <Tab value="mine" label="Saját Munkák" />
            <Tab value="all" label="Összes Munka" />
          </Tabs>

          {activeTab === "mine" ? (
            orderedOwnWorks.length === 0 ? (
              <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
                <CardContent sx={{ textAlign: "center", py: 4 }}>
                  <Typography variant="body2" color="text.secondary">
                    Ebben a műszakban még nincs saját karbantartási munkája.
                  </Typography>
                  <Button
                    variant="text"
                    onClick={() => navigate("/new-maintenance")}
                    disabled={!canStartNewMaintenance}
                    sx={{ mt: 1 }}
                  >
                    Kezdje el az első munkát
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {orderedOwnWorks.map((work) => (
                  <WorkCard
                    key={work.id}
                    work={work}
                    to={`/maintenance/${work.id}`}
                    hideAddress
                    syncState={workSyncStates[work.id]}
                  />
                ))}
              </Box>
            )
          ) : (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {allWorksError ? <Alert severity="error">{allWorksError}</Alert> : null}
              {isLoadingAllWorks && orderedAllWorks.length === 0 ? (
                <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
                  <CardContent sx={{ display: "grid", placeItems: "center", py: 5 }}>
                    <CircularProgress color="secondary" />
                  </CardContent>
                </Card>
              ) : orderedAllWorks.length === 0 ? (
                <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
                  <CardContent sx={{ textAlign: "center", py: 4 }}>
                    <Typography variant="body2" color="text.secondary">
                      Ebben a műszakban még nincs rögzített karbantartási munka.
                    </Typography>
                  </CardContent>
                </Card>
              ) : (
                orderedAllWorks.map((row) => (
                  <ShiftWorkCard
                    key={row.maintenance_id}
                    row={row}
                    syncState={resolveSyncState(row, workSyncStates[row.maintenance_id])}
                    to={todaysWorks.some((work) => work.id === row.maintenance_id) ? `/maintenance/${row.maintenance_id}` : undefined}
                  />
                ))
              )}
            </Box>
          )}
        </Box>
      </Box>
    </Layout>
  );
}
