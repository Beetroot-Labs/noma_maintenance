import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Card,
  CardActionArea,
  CardContent,
  CircularProgress,
  Chip,
  Typography,
} from "@mui/material";
import { ChevronRight, ClipboardList } from "lucide-react";
import { Layout } from "@/components/Layout";
import { appColors } from "@/theme";

type PendingWorksheet = {
  shift_id: string;
  building_name: string;
  building_address: string;
  lead_user_name: string;
  started_at: string | null;
  close_requested_at: string | null;
};

const formatDate = (value: string | null) => {
  if (!value) return null;
  return new Intl.DateTimeFormat("hu-HU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
};

export default function PendingWorksheetsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<PendingWorksheet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetch("/api/shifts/pending", { credentials: "include", cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          const payload = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? "Nem sikerült betölteni a munkalapokat.");
        }
        return r.json() as Promise<PendingWorksheet[]>;
      })
      .then((data) => { if (!cancelled) { setItems(data); setIsLoading(false); } })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Nem sikerült betölteni a munkalapokat.");
          setIsLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, []);

  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            Aláírandó munkalapok
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Az alábbi műszakok lezárva, de a munkalapot még nem írták alá.
          </Typography>
        </Box>

        {error ? <Alert severity="error">{error}</Alert> : null}

        {isLoading ? (
          <Box sx={{ py: 6, display: "grid", placeItems: "center" }}>
            <CircularProgress color="secondary" />
          </Box>
        ) : items.length === 0 ? (
          <Card sx={{ boxShadow: "0 14px 36px rgba(15, 23, 42, 0.08)" }}>
            <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2.5, py: 4 }}>
              <Box
                sx={{
                  width: 56,
                  height: 56,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: "50%",
                  bgcolor: "rgba(15, 23, 42, 0.05)",
                  color: appColors.primary,
                }}
              >
                <ClipboardList size={24} />
              </Box>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  Nincs aláírandó munkalap
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Minden lezárt műszak munkalapja aláírva.
                </Typography>
              </Box>
            </CardContent>
          </Card>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            {items.map((item) => (
              <Card key={item.shift_id} sx={{ boxShadow: "0 4px 16px rgba(15, 23, 42, 0.08)" }}>
                <CardActionArea onClick={() => navigate(`/shifts/${item.shift_id}/summary`)}>
                  <CardContent sx={{ display: "flex", alignItems: "center", gap: 2, py: 2.5 }}>
                    <Box
                      sx={{
                        width: 44,
                        height: 44,
                        display: "grid",
                        placeItems: "center",
                        borderRadius: "50%",
                        bgcolor: "rgba(239, 164, 35, 0.14)",
                        color: appColors.accentForeground,
                        flexShrink: 0,
                      }}
                    >
                      <ClipboardList size={20} />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 700 }} noWrap>
                        {item.building_name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {item.lead_user_name}
                      </Typography>
                      {item.close_requested_at ? (
                        <Typography variant="caption" color="text.secondary">
                          Lezárva: {formatDate(item.close_requested_at)}
                        </Typography>
                      ) : null}
                    </Box>
                    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 0.5 }}>
                      <Chip
                        label="Aláírás szükséges"
                        size="small"
                        sx={{
                          bgcolor: "rgba(239, 164, 35, 0.14)",
                          color: appColors.accentForeground,
                          fontWeight: 600,
                          fontSize: "0.7rem",
                        }}
                      />
                      <ChevronRight size={20} color={appColors.primary} />
                    </Box>
                  </CardContent>
                </CardActionArea>
              </Card>
            ))}
          </Box>
        )}
      </Box>
    </Layout>
  );
}
