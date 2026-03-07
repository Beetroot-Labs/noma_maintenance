import { Box, CircularProgress, CssBaseline, GlobalStyles, ThemeProvider } from "@mui/material";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { NotificationProvider } from "@/components/notifications/NotificationProvider";
import { MaintenanceProvider } from "@/context/MaintenanceContext";
import { DemoUserProvider, useDemoUser } from "@/context/DemoUserContext";
import { theme } from "@/theme";
import MaintenanceHistoryPage from "./pages/MaintenanceHistoryPage";
import LoginPage from "./pages/LoginPage";
import NewMaintenancePage from "./pages/NewMaintenancePage";
import MaintenancePage from "./pages/MaintenancePage";
import OverviewPage from "./pages/OverviewPage";
import DevicesOverview from "./pages/DevicesOverview";
import DeviceDetailsPage from "./pages/DeviceDetailsPage";
import NotFound from "./pages/NotFound";
import StartShiftPage from "./pages/StartShiftPage";
import ShiftWaitingRoomPage from "./pages/ShiftWaitingRoomPage";
import MaintenanceDashboard from "./pages/MaintenanceDashboard";
import ShiftDetails from "./pages/ShiftDetails";

const queryClient = new QueryClient();

const RequireDemoUser = () => {
  const { user, isHydrated } = useDemoUser();
  if (!isHydrated) {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <CircularProgress color="secondary" />
      </Box>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
};

const RedirectAuthenticatedUser = () => {
  const { user, isHydrated } = useDemoUser();
  const location = useLocation();

  if (!isHydrated) {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <CircularProgress color="secondary" />
      </Box>
    );
  }

  if (user) {
    const nextPath = location.state?.from?.pathname ?? "/";
    return <Navigate to={nextPath} replace />;
  }

  return <LoginPage />;
};

const RequireRoles = ({ roles }: { roles: string[] }) => {
  const { user } = useDemoUser();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (!roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles
        styles={{
          "*": { boxSizing: "border-box" },
          body: { margin: 0, backgroundColor: theme.palette.background.default },
          a: { color: "inherit", textDecoration: "none" },
          "@keyframes fadeIn": {
            from: { opacity: 0 },
            to: { opacity: 1 },
          },
          "@keyframes slideIn": {
            from: { opacity: 0, transform: "translateY(-10px)" },
            to: { opacity: 1, transform: "translateY(0)" },
          },
          "@keyframes slideUp": {
            from: { opacity: 0, transform: "translateY(10px)" },
            to: { opacity: 1, transform: "translateY(0)" },
          },
          "@keyframes scaleIn": {
            from: { opacity: 0, transform: "scale(0.96)" },
            to: { opacity: 1, transform: "scale(1)" },
          },
          "@keyframes pulseSoft": {
            "0%, 100%": { opacity: 1 },
            "50%": { opacity: 0.7 },
          },
          "@keyframes pulseSubtle": {
            "0%, 100%": { transform: "scale(1)" },
            "50%": { transform: "scale(1.03)" },
          },
        }}
      />
      <NotificationProvider />
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <DemoUserProvider>
          <MaintenanceProvider>
            <Routes>
              <Route path="/login" element={<RedirectAuthenticatedUser />} />
              <Route element={<RequireDemoUser />}>
                <Route path="/" element={<OverviewPage />} />
                <Route path="/new-maintenance" element={<NewMaintenancePage />} />
                <Route path="/scan" element={<Navigate to="/new-maintenance" replace />} />
                <Route path="/maintenance/:workId" element={<MaintenancePage />} />
                <Route path="/overview" element={<OverviewPage />} />
                <Route path="/dashboard" element={<MaintenanceDashboard />} />
                <Route path="/shift-details" element={<ShiftDetails />} />
                <Route path="/devices" element={<DevicesOverview />} />
                <Route path="/devices/:id" element={<DeviceDetailsPage />} />
                <Route path="/history" element={<MaintenanceHistoryPage />} />
                <Route path="/shifts/:shiftId/waiting-room" element={<ShiftWaitingRoomPage />} />
                <Route element={<RequireRoles roles={["admin", "lead_technician"]} />}>
                  <Route path="/shifts/start" element={<StartShiftPage />} />
                </Route>
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </MaintenanceProvider>
        </DemoUserProvider>
      </BrowserRouter>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
