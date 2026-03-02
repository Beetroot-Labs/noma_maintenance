import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Box, Button, Typography } from "@mui/material";
import { appColors } from "@/theme";

export default function NotFound() {
  const location = useLocation();

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: appColors.muted,
        textAlign: "center",
        px: 2,
      }}
    >
      <Box>
        <Typography variant="h3" sx={{ fontWeight: 700, mb: 1 }}>
          404
        </Typography>
        <Typography variant="h6" color="text.secondary" sx={{ mb: 2 }}>
          Hoppá! Az oldal nem található
        </Typography>
        <Button variant="text" href="/" sx={{ color: appColors.primary }}>
          Vissza a kezdőlapra
        </Button>
      </Box>
    </Box>
  );
}
