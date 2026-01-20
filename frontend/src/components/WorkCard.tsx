import { Card, CardActionArea, CardContent, Typography, Box } from "@mui/material";
import { Camera, Clock, MapPin } from "lucide-react";
import type { MaintenanceWork } from "@/types/maintenance";
import { StatusBadge } from "./StatusBadge";
import { formatTime } from "@/lib/date";
import { deviceKindLabels, getDeviceKindIcon } from "@/lib/deviceKind";

interface WorkCardProps {
  work: MaintenanceWork;
  onClick?: () => void;
}


export function WorkCard({ work, onClick }: WorkCardProps) {
  const duration = work.endTime
    ? Math.round((work.endTime.getTime() - work.startTime.getTime()) / 60000)
    : null;
  const kindLabel =
    deviceKindLabels[work.hvacKind as keyof typeof deviceKindLabels] ?? work.hvacKind;
  const KindIcon = getDeviceKindIcon(work.hvacKind);

  const content = (
    <CardContent sx={{ p: 2 }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", mb: 2 }}>
          <Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <KindIcon size={16} />
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                {kindLabel} · {work.hvacId}
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary">
              {work.hvacModel}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
            <StatusBadge status={work.status} />
            {work.isMalfunctioning && <StatusBadge status="malfunction" />}
          </Box>
        </Box>

        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <MapPin size={16} />
            <Typography variant="body2" color="text.secondary">
              {work.hvacAddress}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <MapPin size={16} />
            <Typography variant="body2" color="text.secondary">
              {work.hvacLocation}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Clock size={16} />
            <Typography variant="body2" color="text.secondary">
              {formatTime(work.startTime)}
              {work.endTime && ` - ${formatTime(work.endTime)}`}
              {duration !== null && ` (${duration} perc)`}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Camera size={16} />
            <Typography variant="body2" color="text.secondary">
              {work.photos.length} fotó
            </Typography>
          </Box>
          {work.notes && (
            <Box sx={{ mt: 1, p: 1, bgcolor: "rgba(0, 0, 0, 0.04)", borderRadius: 1 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                {work.notes}
              </Typography>
            </Box>
          )}
        </Box>
      </CardContent>
  );

  return (
    <Card
      sx={{
        boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)",
        transition: "box-shadow 0.2s ease",
        animation: "slideUp 0.3s ease-out",
        "&:hover": { boxShadow: "0 12px 28px rgba(31, 50, 58, 0.2)" },
      }}
    >
      {onClick ? (
        <CardActionArea onClick={onClick}>{content}</CardActionArea>
      ) : (
        content
      )}
    </Card>
  );
}
