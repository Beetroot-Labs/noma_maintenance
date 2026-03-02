import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#14324a",
    },
    secondary: {
      main: "#c56a2d",
    },
    background: {
      default: "#e8eef1",
      paper: "rgba(255, 255, 255, 0.9)",
    },
    text: {
      primary: "#142334",
      secondary: "#4e6172",
    },
    error: {
      main: "#ab3f16",
    },
  },
  shape: {
    borderRadius: 5,
  },
  typography: {
    fontFamily: '"Segoe UI", sans-serif',
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
});
