import { createTheme } from "@mui/material/styles";

export const appColors = {
  background: "#F6F6F6",
  foreground: "#292728",
  card: "#FFFFFF",
  primary: "#02322D",
  primaryForeground: "#F6F6F6",
  secondary: "#3A785D",
  secondaryForeground: "#F6F6F6",
  muted: "#F0F0F0",
  mutedForeground: "#5C5A5B",
  accent: "#CAAB6A",
  accentForeground: "#292728",
  destructive: "hsl(0 72% 45%)",
  destructiveForeground: "#F6F6F6",
  success: "hsl(142 60% 36%)",
  successForeground: "#F6F6F6",
  warning: "#3A785D",
  warningForeground: "#F6F6F6",
  inProgress: "#3A785D",
  inProgressForeground: "#F6F6F6",
  border: "#3A785D",
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
    borderRadius: 6,
  },
  typography: {
    fontFamily: '"Open Sans", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
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
