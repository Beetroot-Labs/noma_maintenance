import { Box, Typography } from "@mui/material";
import { Layout } from "@/components/Layout";

export default function MaintenanceDashboard() {
  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          Műszak dashboard
        </Typography>
      </Box>
    </Layout>
  );
}
