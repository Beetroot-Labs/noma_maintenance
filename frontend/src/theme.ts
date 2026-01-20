import { createTheme } from "@mui/material/styles";

export const appColors = {
  background: "#0F1729",
  foreground: "hsl(210 40% 98%)",
  card: "hsl(215 40% 22%)",
  primary: "#F9941F",
  primaryForeground: "hsl(215 25% 10%)",
  secondary: "hsl(215 28% 20%)",
  secondaryForeground: "hsl(210 40% 98%)",
  muted: "hsl(215 28% 18%)",
  mutedForeground: "hsl(215 15% 70%)",
  accent: "hsl(36 95% 50%)",
  accentForeground: "hsl(215 25% 10%)",
  destructive: "hsl(0 72% 68%)",
  destructiveForeground: "hsl(0 0% 100%)",
  success: "hsl(142 72% 42%)",
  successForeground: "hsl(0 0% 100%)",
  warning: "hsl(36 95% 50%)",
  warningForeground: "hsl(215 25% 10%)",
  inProgress: "hsl(205 85% 60%)",
  inProgressForeground: "hsl(215 25% 10%)",
  border: "hsl(215 28% 30%)",
};

export const theme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: appColors.primary, contrastText: appColors.primaryForeground },
    secondary: { main: appColors.secondary, contrastText: appColors.secondaryForeground },
    error: { main: appColors.destructive, contrastText: appColors.destructiveForeground },
    success: { main: appColors.success, contrastText: appColors.successForeground },
    warning: { main: appColors.warning, contrastText: appColors.warningForeground },
    text: {
      primary: appColors.foreground,
      secondary: appColors.mutedForeground,
    },
    background: {
      default: appColors.background,
      paper: appColors.card,
    },
    divider: appColors.border,
  },
  shape: {
    borderRadius: 6,
  },
  typography: {
    fontFamily: '"Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
    h1: { fontWeight: 700 },
    h2: { fontWeight: 700 },
    h3: { fontWeight: 700 },
    h4: { fontWeight: 700 },
    h5: { fontWeight: 700 },
    h6: { fontWeight: 700 },
    button: { fontWeight: 700 },
  },
  components: {
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
      styleOverrides: {
        root: {
          textTransform: "none",
          borderRadius: 8,
          fontWeight: 700,
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        size: "small",
      },
    },
    MuiSelect: {
      defaultProps: {
        size: "small",
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderColor: appColors.border,
        },
      },
    },
  },
});
