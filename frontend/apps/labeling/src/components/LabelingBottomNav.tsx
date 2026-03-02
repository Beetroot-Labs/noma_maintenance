import { BottomNavigation, BottomNavigationAction, Paper } from "@mui/material";
import { Camera, LayoutGrid, ScanLine, Tag } from "lucide-react";

export function LabelingBottomNav() {
  return (
    <Paper
      elevation={12}
      sx={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        borderTop: "1px solid",
        borderColor: "primary.main",
        borderRadius: 0,
        background: "primary.main",
        color: "primary.contrastText",
        backdropFilter: "blur(12px)",
        pb: "env(safe-area-inset-bottom)",
      }}
    >
      <BottomNavigation
        showLabels
        value={0}
        sx={{
          bgcolor: "transparent",
          "& .MuiBottomNavigationAction-root": {
            color: "primary.contrastText",
            minWidth: 72,
          },
          "& .Mui-selected": {
            color: "secondary.main",
          },
        }}
      >
        <BottomNavigationAction label="Áttekintés" icon={<LayoutGrid size={18} />} />
        <BottomNavigationAction label="Olvasás" icon={<ScanLine size={18} />} />
        <BottomNavigationAction label="Címkék" icon={<Tag size={18} />} />
        <BottomNavigationAction label="Fotó" icon={<Camera size={18} />} />
      </BottomNavigation>
    </Paper>
  );
}
