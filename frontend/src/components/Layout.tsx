import { ReactNode, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Avatar, Box, Container, Menu, MenuItem, Paper, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { ClipboardList, Home } from "lucide-react";
import { appColors } from "@/theme";
import { FloatingActionButton } from "./FloatingActionButton";
import { useDemoUser } from "@/context/DemoUserContext";

interface LayoutProps {
  children: ReactNode;
}

const navItems = [
  { path: "/", label: "Kezdőlap", icon: Home },
  { path: "/overview", label: "Áttekintés", icon: ClipboardList },
];

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, clearUser } = useDemoUser();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const initials = useMemo(() => {
    if (!user?.name) return "";
    return user.name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }, [user?.name]);

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

  const handleLogout = () => {
    clearUser();
    setMenuAnchor(null);
    navigate("/login");
  };

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
          boxShadow: "0 8px 18px rgba(31, 50, 58, 0.18)",
        }}
      >
        <Container maxWidth="sm" sx={{ py: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              NoMa karbantartás
            </Typography>
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
                    bgcolor: alpha(appColors.primaryForeground, 0.2),
                    color: appColors.primaryForeground,
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {initials}
                </Avatar>
                <Box sx={{ textAlign: "right" }}>
                  <Typography variant="caption" sx={{ opacity: 0.8, display: "block" }}>
                    Bejelentkezve
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {user.name}
                  </Typography>
                </Box>
              </Box>
            )}
          </Box>
        </Container>
      </Box>

      <Container
        component="main"
        maxWidth="sm"
        sx={{ flex: 1, py: 3, pb: 9 }}
      >
        {children}
      </Container>

      <FloatingActionButton />

      <Paper
        component="nav"
        elevation={8}
        sx={{
          position: "sticky",
          bottom: 0,
          borderTop: `1px solid ${appColors.border}`,
        }}
      >
        <Container maxWidth="sm" sx={{ display: "flex", gap: 2, py: 0.5 }}>
          {navItems.map(({ path, label, icon: Icon }) => {
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
                  color: isActive ? appColors.primary : appColors.mutedForeground,
                  bgcolor: isActive ? alpha(appColors.primary, 0.1) : "transparent",
                  transition: "background-color 0.2s ease, color 0.2s ease",
                  "&:hover": {
                    color: appColors.foreground,
                    bgcolor: appColors.muted,
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

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleCloseMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem
          onClick={handleLogout}
          sx={{ color: appColors.destructive, fontWeight: 700 }}
        >
          Kijelentkezés
        </MenuItem>
      </Menu>
    </Box>
  );
}
