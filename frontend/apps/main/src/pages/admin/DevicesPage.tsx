import { Alert, Box, Typography } from "@mui/material";
import { Layout } from "@/components/Layout";

export default function DevicesPage() {
  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            Berendezések
          </Typography>
        </Box>

        <Alert severity="info">A berendezések admin oldal hamarosan érkezik.</Alert>
      </Box>
    </Layout>
  );
}
