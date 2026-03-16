import { useState } from "react";
import { Box, Card, CardContent, ClickAwayListener, IconButton, Tooltip, Typography } from "@mui/material";
import { Link } from "react-router-dom";
import { Camera, Clock, CloudAlert, CloudCog, CloudUpload, MapPin } from "lucide-react";
import { getDeviceKindLabel } from "@noma/shared";
import type { MaintenanceWork, MaintenanceWorkSyncState } from "@/types/maintenance";
import { StatusBadge } from "./StatusBadge";
import { formatTime } from "@/lib/date";
import { getDeviceKindIcon } from "@/lib/deviceKind";

interface WorkCardProps {
  work: MaintenanceWork;
  to?: string;
  onClick?: () => void;
  hideAddress?: boolean;
  syncState?: MaintenanceWorkSyncState;
}

export function WorkCard({ work, to, onClick, hideAddress = false, syncState }: WorkCardProps) {
  const duration = work.endTime
    ? Math.round((work.endTime.getTime() - work.startTime.getTime()) / 60000)
    : null;
  const kindLabel = getDeviceKindLabel(work.hvacKind);
  const KindIcon = getDeviceKindIcon(work.hvacKind);
  const isClickable = Boolean(to || onClick);
  const [isErrorTooltipOpen, setIsErrorTooltipOpen] = useState(false);

  const effectiveSyncState =
    syncState ?? {
      status: work.status === "completed" ? "synced" : "retriable",
      lastError: null,
    };

  const syncLabel =
    effectiveSyncState.status === "synced"
      ? "Feltöltve"
      : effectiveSyncState.status === "error"
        ? "Feltöltési hiba"
        : work.status === "completed"
          ? "Feltöltésre vár"
          : "Nincs feltöltve";
  const SyncIcon =
    effectiveSyncState.status === "synced"
      ? CloudUpload
      : effectiveSyncState.status === "error"
        ? CloudAlert
        : CloudCog;
  const syncColor =
    effectiveSyncState.status === "synced"
      ? "success.main"
      : effectiveSyncState.status === "error"
        ? "error.main"
        : "warning.main";

  return (
    <Card
      component={to ? Link : "div"}
      to={to}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        if (!onClick) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      sx={{
        boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)",
        transition: "box-shadow 0.2s ease",
        animation: "slideUp 0.3s ease-out",
        cursor: isClickable ? "pointer" : "default",
        textDecoration: "none",
        "&:hover": isClickable ? { boxShadow: "0 12px 28px rgba(31, 50, 58, 0.2)" } : undefined,
        "&:focus-visible": isClickable
          ? { outline: "none", boxShadow: "0 0 0 3px rgba(2, 50, 45, 0.3)" }
          : undefined,
      }}
    >
      <CardContent sx={{ p: 2 }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", mb: 2 }}>
          <Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <KindIcon size={16} />
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                {kindLabel} · {work.hvacId}
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary">
              {work.hvacModel}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
            <StatusBadge status={work.status} />
            {work.isMalfunctioning && <StatusBadge status="malfunction" />}
          </Box>
        </Box>

        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {!hideAddress && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <MapPin size={16} />
              <Typography variant="body2" color="text.secondary">
                {work.hvacAddress}
              </Typography>
            </Box>
          )}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <MapPin size={16} />
            <Typography variant="body2" color="text.secondary">
              {work.hvacLocation}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Clock size={16} />
            <Typography variant="body2" color="text.secondary">
              {formatTime(work.startTime)}
              {work.endTime && ` - ${formatTime(work.endTime)}`}
              {duration !== null && ` (${duration} perc)`}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Camera size={16} />
            <Typography variant="body2" color="text.secondary">
              {work.photos.length} fotó
            </Typography>
          </Box>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 1,
              mt: 0.5,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: syncColor }}>
              <SyncIcon size={16} />
              <Typography variant="body2" sx={{ color: syncColor }}>
                {syncLabel}
              </Typography>
            </Box>
            {effectiveSyncState.status === "error" && effectiveSyncState.lastError ? (
              <ClickAwayListener onClickAway={() => setIsErrorTooltipOpen(false)}>
                <Tooltip
                  open={isErrorTooltipOpen}
                  title={effectiveSyncState.lastError}
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
          {work.notes && (
            <Box sx={{ mt: 1, p: 1, bgcolor: "rgba(0, 0, 0, 0.04)", borderRadius: 1 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                {work.notes}
              </Typography>
            </Box>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}
