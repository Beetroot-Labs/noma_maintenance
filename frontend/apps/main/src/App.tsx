import { Box, CircularProgress, CssBaseline, GlobalStyles, ThemeProvider } from "@mui/material";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { useEffect } from "react";
import LogRocket from "logrocket";
import { NotificationProvider } from "@/components/notifications/NotificationProvider";
import { MaintenanceProvider } from "@/context/MaintenanceContext";
import { DemoUserProvider, useDemoUser } from "@/context/DemoUserContext";
import { ShiftProvider, useShift } from "@/context/ShiftContext";
import { theme } from "@/theme";
import LoginPage from "./pages/LoginPage";
import NewMaintenancePage from "./pages/NewMaintenancePage";
import MaintenancePage from "./pages/MaintenancePage";
import DeviceDetailsPage from "./pages/DeviceDetailsPage";
import NotFound from "./pages/NotFound";
import StartShiftPage from "./pages/StartShiftPage";
import ShiftWaitingRoomPage from "./pages/ShiftWaitingRoomPage";
import MaintenanceDashboard from "./pages/MaintenanceDashboard";
import MyCurrentShiftPage from "./pages/MyCurrentShiftPage";
import ShiftHomePage from "./pages/ShiftHomePage";
import ShiftSummaryPage from "./pages/ShiftSummaryPage";
import PendingWorksheetsPage from "./pages/PendingWorksheetsPage";
import AdminShiftsPage from "./pages/AdminShiftsPage";
import ShiftDetailsPage from "./pages/ShiftDetailsPage";
import MaintenanceDetailsPage from "./pages/MaintenanceDetailsPage";

const queryClient = new QueryClient();

const LogRocketIdentifier = () => {
  const { user } = useDemoUser();
  useEffect(() => {
    if (user && !import.meta.env.DEV) {
      LogRocket.identify(user.id, { name: user.name, email: user.email });
    }
  }, [user]);
  return null;
};

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

const ShiftDashboardRoute = () => {
  const { currentShift, isLoading } = useShift();

  if (isLoading) {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <CircularProgress color="secondary" />
      </Box>
    );
  }

  if (!currentShift) {
    return <Navigate to="/" replace />;
  }

  if (currentShift.status === "INVITING" || currentShift.status === "READY_TO_START") {
    return <Navigate to={`/shifts/${currentShift.id}/waiting-room`} replace />;
  }

  return <MaintenanceDashboard />;
};

const RequireMaintenanceStartAllowed = () => {
  const { currentShift, isLoading } = useShift();

  if (isLoading) {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <CircularProgress color="secondary" />
      </Box>
    );
  }

  if (
    currentShift &&
    currentShift.status === "CLOSE_REQUESTED"
  ) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
};

const RequireActiveShift = () => {
  const { currentShift, isLoading } = useShift();

  if (isLoading) {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <CircularProgress color="secondary" />
      </Box>
    );
  }

  if (!currentShift) {
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
          <LogRocketIdentifier />
          <ShiftProvider>
            <MaintenanceProvider>
              <Routes>
                <Route path="/login" element={<RedirectAuthenticatedUser />} />
                <Route element={<RequireDemoUser />}>
                  <Route path="/" element={<ShiftHomePage />} />
                  <Route path="/dashboard" element={<ShiftDashboardRoute />} />
                  <Route path="/shifts/:shiftId/waiting-room" element={<ShiftWaitingRoomPage />} />
                  <Route element={<RequireRoles roles={["admin", "lead_technician"]} />}>
                    <Route path="/admin/shifts" element={<AdminShiftsPage />} />
                    <Route path="/admin/shifts/:shiftId" element={<ShiftDetailsPage />} />
                    <Route
                      path="/admin/shifts/:shiftId/maintenances/:maintenanceId"
                      element={<MaintenanceDetailsPage />}
                    />
                  </Route>
                  <Route element={<RequireActiveShift />}>
                    <Route element={<RequireMaintenanceStartAllowed />}>
                      <Route path="/new-maintenance" element={<NewMaintenancePage />} />
                      <Route path="/scan" element={<Navigate to="/new-maintenance" replace />} />
                    </Route>
                    <Route path="/maintenance/:workId" element={<MaintenancePage />} />
                    <Route path="/shift-details" element={<MyCurrentShiftPage />} />
                    <Route path="/shift-summary" element={<ShiftSummaryPage />} />
                    <Route path="/devices/:id" element={<DeviceDetailsPage />} />
                  </Route>
                  <Route element={<RequireRoles roles={["admin", "lead_technician"]} />}>
                    <Route path="/shifts/start" element={<StartShiftPage />} />
                    <Route path="/pending-worksheets" element={<PendingWorksheetsPage />} />
                    <Route path="/shifts/:shiftId/summary" element={<ShiftSummaryPage />} />
                  </Route>
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </MaintenanceProvider>
          </ShiftProvider>
        </DemoUserProvider>
      </BrowserRouter>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
