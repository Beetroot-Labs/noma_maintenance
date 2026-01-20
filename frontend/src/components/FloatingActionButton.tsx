import { Link, useLocation } from "react-router-dom";
import { Box, Button } from "@mui/material";
import { ArrowRight, Play } from "lucide-react";
import { appColors } from "@/theme";
import { useMaintenance } from "@/context/MaintenanceContext";

export function FloatingActionButton() {
  const { currentWork } = useMaintenance();
  const location = useLocation();

  if (location.pathname === "/scan") return null;
  if (currentWork && location.pathname === `/maintenance/${currentWork.id}`) return null;

  const isContinue = Boolean(currentWork);
  const href = isContinue ? `/maintenance/${currentWork?.id}` : "/scan";

  return (
    <Box sx={{ position: "fixed", bottom: 76, right: 16, zIndex: 40 }}>
      <Button
        component={Link}
        to={href}
        variant="contained"
        startIcon={isContinue ? undefined : <Play size={18} />}
        endIcon={isContinue ? <ArrowRight size={18} /> : undefined}
        sx={{
          borderRadius: 999,
          px: 2.5,
          py: 1.2,
          bgcolor: isContinue ? appColors.inProgress : appColors.accent,
          color: isContinue ? appColors.inProgressForeground : appColors.accentForeground,
          fontWeight: 700,
          boxShadow: "0 10px 24px rgba(20, 30, 36, 0.25)",
          animation: isContinue ? "pulseSubtle 2s ease-in-out infinite" : "none",
          "&:hover": {
            bgcolor: isContinue
              ? "hsl(215 50% 20%)"
              : "hsl(36 95% 45%)",
          },
        }}
      >
        {isContinue ? "Munka folytatása" : "Munka indítása"}
      </Button>
    </Box>
  );
}
