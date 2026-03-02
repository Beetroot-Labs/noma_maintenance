import { createTheme } from "@mui/material/styles";

const appColors = {
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
  border: "#3A785D",
};

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: appColors.primary,
      contrastText: appColors.primaryForeground,
    },
    secondary: {
      main: appColors.secondary,
      contrastText: appColors.secondaryForeground,
    },
    background: {
      default: appColors.background,
      paper: appColors.card,
    },
    text: {
      primary: appColors.foreground,
      secondary: appColors.mutedForeground,
    },
    error: {
      main: appColors.destructive,
      contrastText: appColors.destructiveForeground,
    },
    divider: appColors.border,
  },
  shape: {
    borderRadius: 5,
  },
  typography: {
    fontFamily: '"Open Sans", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
    h1: {
      fontSize: "clamp(2.6rem, 8vw, 4rem)",
      lineHeight: 0.95,
      letterSpacing: "-0.05em",
      fontWeight: 700,
    },
    h2: {
      fontSize: "1.25rem",
      fontWeight: 700,
      letterSpacing: "-0.02em",
    },
    button: {
      textTransform: "none",
      fontWeight: 600,
    },
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
    MuiPaper: {
      styleOverrides: {
        root: {
          borderColor: appColors.border,
        },
      },
    },
  },
});
