import { createTheme } from "@mui/material/styles";

export const appColors = {
  background: "hsl(200 15% 97%)",
  foreground: "hsl(200 15% 20%)",
  card: "hsl(0 0% 100%)",
  primary: "hsl(200 25% 40%)",
  primaryForeground: "hsl(0 0% 100%)",
  secondary: "hsl(200 10% 93%)",
  secondaryForeground: "hsl(200 15% 25%)",
  muted: "hsl(200 10% 95%)",
  mutedForeground: "hsl(200 10% 45%)",
  accent: "hsl(15 65% 55%)",
  accentForeground: "hsl(0 0% 100%)",
  destructive: "hsl(0 55% 55%)",
  destructiveForeground: "hsl(0 0% 100%)",
  success: "hsl(155 45% 42%)",
  successForeground: "hsl(0 0% 100%)",
  warning: "hsl(40 70% 50%)",
  warningForeground: "hsl(0 0% 15%)",
  inProgress: "hsl(195 50% 48%)",
  inProgressForeground: "hsl(0 0% 100%)",
  border: "hsl(200 15% 88%)",
};

export const theme = createTheme({
  palette: {
    mode: "light",
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
    borderRadius: 12,
  },
  typography: {
    fontFamily: '"Manrope", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
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
          borderRadius: 12,
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
