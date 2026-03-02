import { Chip } from "@mui/material";
import { appColors } from "@/theme";

type StatusType = "in-progress" | "completed" | "malfunction";

const statusConfig: Record<StatusType, { label: string; bg: string; color: string }> = {
  "in-progress": {
    label: "Folyamatban",
    bg: appColors.inProgress,
    color: appColors.inProgressForeground,
  },
  completed: { label: "Kész", bg: appColors.success, color: appColors.successForeground },
  malfunction: {
    label: "Hibás",
    bg: appColors.destructive,
    color: appColors.destructiveForeground,
  },
};

interface StatusBadgeProps {
  status: StatusType;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const { label, bg, color } = statusConfig[status];

  return (
    <Chip
      label={label}
      size="small"
      sx={{
        bgcolor: bg,
        color,
        fontWeight: 700,
        fontSize: 11,
        height: 24,
      }}
    />
  );
}
