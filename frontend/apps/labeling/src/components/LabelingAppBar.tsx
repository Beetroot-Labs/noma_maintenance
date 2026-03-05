import {
  AccountCircleOutlined,
  CloudDoneOutlined,
  LocationOnOutlined,
  PriorityHighOutlined,
  SyncOutlined,
  SyncProblemOutlined,
} from "@mui/icons-material";
import { Alert, AppBar, Box, ButtonBase, Divider, IconButton, Menu, MenuItem, Snackbar, Stack, Toolbar, Tooltip, Typography } from "@mui/material";
import { LogOut } from "lucide-react";
import { useCallback, useState } from "react";
import { useOfflineSyncSummary } from "@noma/shared";
import logoWhite from "../../../main/public/Noma_logo_white_horizontal.png";
import { getSyncStatusSummary } from "../lib/offlineCache";

const accentColor = "#CAAB6A";

type LabelingAppBarProps = {
  userName: string;
  userEmail: string;
  buildingName: string | null;
  onBuildingClick: () => void;
  onSyncStatusClick: () => Promise<void> | void;
  onLogout: () => Promise<void> | void;
};

export function LabelingAppBar({
  userName,
  userEmail,
  buildingName,
  onBuildingClick,
  onSyncStatusClick,
  onLogout,
}: LabelingAppBarProps) {
  const [accountMenuAnchor, setAccountMenuAnchor] = useState<null | HTMLElement>(null);
  const [isSyncIconHovered, setIsSyncIconHovered] = useState(false);
  const [syncReloadFeedback, setSyncReloadFeedback] = useState<{
    message: string;
    severity: "success" | "error";
  } | null>(null);

  const loadSyncSummary = useCallback(() => getSyncStatusSummary(), []);
  const { hasRetryableChanges: hasRetryableSyncChanges, hasSyncErrors } =
    useOfflineSyncSummary(loadSyncSummary, 5000);

  const handleOpenAccountMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAccountMenuAnchor(event.currentTarget);
  };

  const handleCloseAccountMenu = () => {
    setAccountMenuAnchor(null);
  };

  const handleLogout = async () => {
    handleCloseAccountMenu();
    await onLogout();
  };

  const handleSyncStatusClick = async () => {
    try {
      await onSyncStatusClick();
      setSyncReloadFeedback({
        message: "Az offline gyorsítótár sikeresen frissült.",
        severity: "success",
      });
    } catch {
      setSyncReloadFeedback({
        message: "Nem sikerült frissíteni az offline adatokat.",
        severity: "error",
      });
    }
  };

  const syncIndicatorConfig = hasRetryableSyncChanges
    ? hasSyncErrors
      ? {
          icon: <SyncProblemOutlined sx={{ fontSize: 19, color: "inherit" }} />,
          color: "#FFB3B3",
          label: "Szinkronizációs hibák vannak, és maradtak függőben lévő változtatások.",
        }
      : {
          icon: <SyncOutlined sx={{ fontSize: 19, color: "inherit" }} />,
          color: "#FFE08A",
          label: "Nem mentett változások vannak, szinkronizálás szükséges.",
        }
    : hasSyncErrors
      ? {
          icon: <PriorityHighOutlined sx={{ fontSize: 19, color: "inherit" }} />,
          color: "#FFB3B3",
          label: "Szinkronizációs hibák vannak. Kérjük ellenőrizd a módosításokat.",
        }
      : {
          icon: <CloudDoneOutlined sx={{ fontSize: 19, color: "inherit" }} />,
          color: "#FFFFFF",
          label: "Minden változás szinkronizálva.",
        };

  return (
    <>
      <AppBar
        position="sticky"
        elevation={0}
        sx={{
          background: "primary.main",
          color: "primary.contrastText",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          backdropFilter: "blur(12px)",
        }}
      >
        <Toolbar
          sx={{
            minHeight: "unset",
            display: "flex",
            alignItems: "center",
            gap: 1.25,
            px: 2,
            pt: "max(8px, env(safe-area-inset-top))",
            pb: 1,
          }}
        >
          <Box sx={{ minWidth: 0, flexShrink: 0 }}>
            <Box
              component="img"
              src={logoWhite}
              alt="NoMa"
              sx={{
                display: "block",
                width: 148,
                height: 28,
                objectFit: "cover",
                objectPosition: "center",
              }}
            />
          </Box>
          <ButtonBase
            onClick={onBuildingClick}
            sx={{
              minWidth: 0,
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 1.25,
              borderRadius: "5px",
              px: 1.25,
              py: 1,
              backgroundColor: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.08)",
              textAlign: "left",
            }}
          >
            <Stack direction="row" alignItems="center" gap={1.25} sx={{ width: "100%" }}>
              <LocationOnOutlined sx={{ fontSize: 18, color: accentColor, flexShrink: 0 }} />
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  variant="body2"
                  sx={{
                    color: "primary.contrastText",
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {buildingName ?? "Épület kiválasztása"}
                </Typography>
              </Box>
            </Stack>
          </ButtonBase>

          <Tooltip
            title={syncIndicatorConfig.label}
            arrow
          >
            <IconButton
              onClick={() => void handleSyncStatusClick()}
              onMouseEnter={() => setIsSyncIconHovered(true)}
              onMouseLeave={() => setIsSyncIconHovered(false)}
              sx={{
                color: syncIndicatorConfig.color,
                width: 32,
                height: 32,
                flexShrink: 0,
                borderRadius: "5px",
                "&:hover": {
                  backgroundColor: "rgba(255,255,255,0.08)",
                },
              }}
              aria-label={syncIndicatorConfig.label}
            >
              {isSyncIconHovered ? (
                <SyncOutlined sx={{ fontSize: 19, color: "common.white" }} />
              ) : (
                syncIndicatorConfig.icon
              )}
            </IconButton>
          </Tooltip>

          <IconButton onClick={handleOpenAccountMenu} sx={{ color: accentColor, mr: -1, flexShrink: 0 }}>
            <AccountCircleOutlined sx={{ fontSize: 30 }} />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Menu
        anchorEl={accountMenuAnchor}
        open={Boolean(accountMenuAnchor)}
        onClose={handleCloseAccountMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        PaperProps={{
          sx: {
            mt: 0.5,
            minWidth: 240,
            borderRadius: "5px",
          },
        }}
      >
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {userName}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {userEmail}
          </Typography>
        </Box>
        <Divider />
        <MenuItem onClick={() => void handleLogout()} sx={{ color: "error.main", fontWeight: 600 }}>
          <LogOut size={16} style={{ marginRight: 8 }} />
          Kijelentkezés
        </MenuItem>
      </Menu>

      <Snackbar
        open={Boolean(syncReloadFeedback)}
        autoHideDuration={3500}
        onClose={(_, reason) => {
          if (reason === "clickaway") {
            return;
          }
          setSyncReloadFeedback(null);
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={() => setSyncReloadFeedback(null)}
          severity={syncReloadFeedback?.severity ?? "success"}
          variant="filled"
          sx={{ width: "100%" }}
        >
          {syncReloadFeedback?.message}
        </Alert>
      </Snackbar>
    </>
  );
}
