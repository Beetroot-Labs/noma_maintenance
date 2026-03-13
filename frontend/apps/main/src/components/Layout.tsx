import { ReactNode, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Avatar,
  Box,
  Container,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import {
  CircleUser,
  HardHat,
  LogOut,
  Menu as MenuIcon,
  Play,
  ScanBarcode,
  Wrench,
} from "lucide-react";
import { appColors } from "@/theme";
import { useDemoUser } from "@/context/DemoUserContext";
import { useMaintenance } from "@/context/MaintenanceContext";
import { useShift } from "@/context/ShiftContext";

interface LayoutProps {
  children: ReactNode;
}

const navItems = [
  { path: "/shift-details", label: "Műszak", icon: HardHat },
  { path: "/dashboard", label: "Karbantartás", icon: Wrench },
];

export function Layout({ children }: LayoutProps) {
  const theme = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));
  const { user, clearUser } = useDemoUser();
  const { currentWork } = useMaintenance();
  const { currentShift } = useShift();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isAdminView = location.pathname.startsWith("/admin");
  const canAccessAdminView = user?.role === "admin";
  const showBottomBar = Boolean(currentShift) && !isAdminView;
  const canStartNewMaintenance =
    currentShift?.status !== "CLOSE_REQUESTED" && currentShift?.status !== "READY_TO_COMMIT";
  const startActionDisabled = !currentWork && !canStartNewMaintenance;

  const roleLabel = {
    admin: "adminisztrátor",
    lead_technician: "műszakvezető",
    technician: "technikus",
    viewer: "megtekintő",
    partner: "partner",
  };

  const handleOpenMenu = (event: React.MouseEvent<HTMLElement>) => {
    setMenuAnchor(event.currentTarget);
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setMenuAnchor(event.currentTarget);
    }
  };

  const handleCloseMenu = () => setMenuAnchor(null);

  const handleLogout = async () => {
    await clearUser();
    setMenuAnchor(null);
    navigate("/login");
  };

  const handleToggleView = () => {
    setMenuAnchor(null);
    navigate(isAdminView ? "/" : "/admin/shifts");
  };

  const handleDrawerOpen = () => setDrawerOpen(true);
  const handleDrawerClose = () => setDrawerOpen(false);

  return (
    <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Box
        component="header"
        sx={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          bgcolor: appColors.primary,
          color: appColors.primaryForeground,
          borderBottom: `1px solid ${appColors.primary}`,
          boxShadow: "0 6px 14px rgba(15, 23, 42, 0.08)",
        }}
      >
        <Container maxWidth="lg" sx={{ height: 56, display: "flex", alignItems: "center" }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, width: "100%" }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              {isDesktop && !isAdminView ? (
                <IconButton onClick={handleDrawerOpen} aria-label="Menü megnyitása" sx={{ color: appColors.accent}}>
                  <MenuIcon size={20} />
                </IconButton>
              ) : null}
              <Box
                component="img"
                src={`${import.meta.env.BASE_URL}logo-white.webp`}
                alt="NoMa"
                sx={{ height: 28, width: "auto" }}
              />
            </Box>
            {user && (
              <Box
                onClick={handleOpenMenu}
                onKeyDown={handleMenuKeyDown}
                role="button"
                tabIndex={0}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  cursor: "pointer",
                }}
              >
                <Avatar
                  sx={{
                    width: 32,
                    height: 32,
                    bgcolor: "transparent",
                    color: appColors.accent,
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  <CircleUser size={24} />
                </Avatar>
              </Box>
            )}
          </Box>
        </Container>
      </Box>

      <Container
        component="main"
        maxWidth="lg"
        sx={{ flex: 1, py: 3, pb: { xs: showBottomBar ? 9 : 3, md: 4 } }}
      >
        <Box
          key={location.pathname}
          sx={{
            animation: "fadeIn 0.22s ease, slideUp 0.22s ease",
            willChange: "opacity, transform",
          }}
        >
          {children}
        </Box>
      </Container>

      {showBottomBar ? (
        <Paper
          component="nav"
          elevation={8}
          sx={{
            position: "sticky",
            bottom: 0,
            borderTop: `1px solid ${appColors.primary}`,
            bgcolor: appColors.primary,
            color: appColors.primaryForeground,
            display: { xs: "block", md: "none" },
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
          }}
        >
          <Container maxWidth="md" sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              py: 0.75,
              pb: 2,
          }}>
            {navItems.slice(0, 1).map(({ path, label, icon: Icon }) => {
              const isActive = location.pathname === path;
              return (
                <Box
                  key={path}
                  component={Link}
                  to={path}
                  sx={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 0.5,
                    py: 1,
                    borderRadius: 2,
                    color: isActive ? appColors.accent : appColors.primaryForeground,
                    bgcolor: "transparent",
                    transition: "background-color 0.2s ease, color 0.2s ease",
                    "&:hover": {
                      color: appColors.accent,
                    },
                  }}
                >
                  <Icon size={20} />
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>
                    {label}
                  </Typography>
                </Box>
              );
            })}
            <Box
              component={startActionDisabled ? "div" : Link}
              to={startActionDisabled ? undefined : currentWork ? `/maintenance/${currentWork.id}` : "/new-maintenance"}
              sx={{
                width: 54,
                height: 54,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "50%",
                bgcolor: appColors.accent,
                color: appColors.foreground,
                boxShadow: "0 10px 24px rgba(15, 23, 42, 0.2)",
                opacity: startActionDisabled ? 0.45 : 1,
                "&:hover": {
                  bgcolor: appColors.accent,
                },
              }}
              aria-label={currentWork ? "Munka folytatása" : "Munka indítása"}
            >
              {currentWork ? <Play size={20} /> : <ScanBarcode size={22} />}
            </Box>
            {navItems.slice(1).map(({ path, label, icon: Icon }) => {
              const isActive = location.pathname === path;
              return (
                <Box
                  key={path}
                  component={Link}
                  to={path}
                  sx={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 0.5,
                    py: 1,
                    borderRadius: 2,
                    color: isActive ? appColors.accent : appColors.primaryForeground,
                    bgcolor: "transparent",
                    transition: "background-color 0.2s ease, color 0.2s ease",
                    "&:hover": {
                      color: appColors.accent,
                    },
                  }}
                >
                  <Icon size={20} />
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>
                    {label}
                  </Typography>
                </Box>
              );
            })}
          </Container>
        </Paper>
      ) : null}

      {!isAdminView ? (
        <Drawer
          anchor="left"
          open={drawerOpen}
          onClose={handleDrawerClose}
          PaperProps={{
            sx: {
              width: 260,
              bgcolor: appColors.primary,
              color: appColors.primaryForeground,
            },
          }}
        >
          <Box sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Menü
            </Typography>
          </Box>
          <Divider sx={{ borderColor: appColors.border }} />
          <List sx={{ px: 1 }}>
            {navItems.map(({ path, label, icon: Icon }) => (
              <ListItemButton
                key={path}
                component={Link}
                to={path}
                onClick={handleDrawerClose}
                selected={location.pathname === path}
                sx={{
                  borderRadius: 2,
                  "&.Mui-selected": {
                    bgcolor: alpha(appColors.accent, 0.15),
                    color: appColors.accent,
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 36, color: "inherit" }}>
                  <Icon size={18} />
                </ListItemIcon>
                <ListItemText primary={label} />
              </ListItemButton>
            ))}
          </List>
          <Divider sx={{ borderColor: appColors.border, mt: 1 }} />
          <List sx={{ px: 1 }}>
            <ListItemButton
              component={startActionDisabled ? "div" : Link}
              to={startActionDisabled ? undefined : currentWork ? `/maintenance/${currentWork.id}` : "/new-maintenance"}
              onClick={startActionDisabled ? undefined : handleDrawerClose}
              disabled={startActionDisabled}
              sx={{
                borderRadius: 2,
                bgcolor: alpha(appColors.accent, 0.15),
                color: appColors.accent,
                fontWeight: 700,
                "&:hover": {
                  bgcolor: alpha(appColors.accent, 0.25),
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 36, color: "inherit" }}>
                {currentWork ? <Play size={18} /> : <ScanBarcode size={18} />}
              </ListItemIcon>
              <ListItemText primary={currentWork ? "Munka folytatása" : "Munka indítása"} />
            </ListItemButton>
          </List>
        </Drawer>
      ) : null}

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleCloseMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        {canAccessAdminView ? (
          <MenuItem onClick={handleToggleView}>
            {isAdminView ? "Maintenance view" : "Admin view"}
          </MenuItem>
        ) : null}
        {canAccessAdminView ? <Divider sx={{ borderColor: "rgba(0, 0, 0, 0.12)" }} /> : null}
        <MenuItem
          onClick={handleLogout}
          sx={{ color: appColors.destructive, fontWeight: 700 }}
        >
          <LogOut size={16} style={{ marginRight: 8 }} />
          Kijelentkezés
        </MenuItem>
        {user && (
          <>
            <Divider sx={{ borderColor: "rgba(0, 0, 0, 0.3)" }} />
            <Box sx={{ px: 2, pb: 1.5, pt: 1 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                {user.name}
              </Typography>
              <Typography variant="caption" sx={{ fontWeight: 700, textTransform: "uppercase" }}>
                {roleLabel[user.role]}
              </Typography>
            </Box>
          </>
        )}
      </Menu>
    </Box>
  );
}
