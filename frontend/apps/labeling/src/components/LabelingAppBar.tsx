import { AccountCircleOutlined, LocationOnOutlined } from "@mui/icons-material";
import { AppBar, Box, ButtonBase, Divider, IconButton, Menu, MenuItem, Stack, Toolbar, Typography } from "@mui/material";
import { LogOut } from "lucide-react";
import { useState } from "react";
import logoWhite from "../../../main/public/Noma_logo_white_horizontal.png";

const accentColor = "#CAAB6A";

type LabelingAppBarProps = {
  userName: string;
  userEmail: string;
  buildingName: string | null;
  onBuildingClick: () => void;
  onLogout: () => Promise<void> | void;
};

export function LabelingAppBar({
  userName,
  userEmail,
  buildingName,
  onBuildingClick,
  onLogout,
}: LabelingAppBarProps) {
  const [accountMenuAnchor, setAccountMenuAnchor] = useState<null | HTMLElement>(null);

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
    </>
  );
}
