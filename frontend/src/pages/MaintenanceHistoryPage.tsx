import { Box, Card, CardContent, Typography } from "@mui/material";
import { Layout } from "@/components/Layout";
import { WorkCard } from "@/components/WorkCard";
import { useMaintenance } from "@/context/MaintenanceContext";
import { appColors } from "@/theme";

const formatDay = (date: Date) =>
  new Intl.DateTimeFormat("hu-HU", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);

export default function MaintenanceHistoryPage() {
  const { pastWorks } = useMaintenance();

  const works = [...pastWorks].sort((a, b) => {
    const aTime = a.endTime?.getTime() ?? a.startTime.getTime();
    const bTime = b.endTime?.getTime() ?? b.startTime.getTime();
    return bTime - aTime;
  });

  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3, animation: "slideUp 0.3s ease-out" }}>
        <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Karbantartási előzmények
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {works.length} lezárt munka
          </Typography>
        </Box>

        {works.length === 0 ? (
          <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
            <CardContent sx={{ textAlign: "center", py: 6 }}>
              <Typography variant="body2" color="text.secondary">
                Még nincs lezárt karbantartás.
              </Typography>
            </CardContent>
          </Card>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {works.map((work, index) => {
              const dateLabel = formatDay(work.endTime ?? work.startTime);
              const previousDate = works[index - 1]?.endTime ?? works[index - 1]?.startTime;
              const showDate = index === 0 || formatDay(previousDate) !== dateLabel;
              return (
                <Box key={work.id} sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                  {showDate && (
                    <Typography variant="subtitle2" sx={{ color: appColors.mutedForeground, fontWeight: 600 }}>
                      {dateLabel}
                    </Typography>
                  )}
                  <WorkCard work={work} to={`/maintenance/${work.id}`} />
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
    </Layout>
  );
}
