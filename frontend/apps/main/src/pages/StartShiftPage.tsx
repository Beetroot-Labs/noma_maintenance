import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  TextField,
  Typography,
} from "@mui/material";
import { Layout } from "@/components/Layout";

type BuildingOption = {
  id: string;
  name: string;
  address: string;
};

type CreateShiftResponse = {
  shift_id: string;
};

const readApiErrorMessage = async (response: Response, fallback: string) => {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // ignore malformed payload
  }
  return fallback;
};

export default function StartShiftPage() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buildings, setBuildings] = useState<BuildingOption[]>([]);
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingOption | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const buildingsResponse = await fetch("/api/labeling/buildings", { credentials: "include" });
        if (!buildingsResponse.ok) {
          throw new Error(await readApiErrorMessage(buildingsResponse, "Nem sikerült betölteni az épületeket."));
        }

        const buildingsPayload = (await buildingsResponse.json()) as BuildingOption[];
        if (!cancelled) {
          setBuildings(buildingsPayload);
          setSelectedBuilding(buildingsPayload[0] ?? null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Nem sikerült előkészíteni a műszakot.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCreateShift = async () => {
    if (!selectedBuilding) {
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/shifts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          building_id: selectedBuilding.id,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, "Nem sikerült létrehozni a műszakot."));
      }

      const payload = (await response.json()) as CreateShiftResponse;
      navigate(`/shifts/${payload.shift_id}/waiting-room`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nem sikerült létrehozni a műszakot.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          Műszak indítása
        </Typography>

        <Card>
          <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {error ? <Alert severity="error">{error}</Alert> : null}

            {isLoading ? (
              <Box sx={{ py: 4, display: "grid", placeItems: "center" }}>
                <CircularProgress color="secondary" />
              </Box>
            ) : (
              <>
                <Autocomplete
                  options={buildings}
                  value={selectedBuilding}
                  onChange={(_, value) => setSelectedBuilding(value)}
                  getOptionLabel={(option) => `${option.name} (${option.address})`}
                  renderInput={(params) => <TextField {...params} label="Épület kiválasztása" />}
                />
                <Typography variant="body2" color="text.secondary">
                  A műszak létrehozásakor csak a műszakvezető kerül a résztvevők közé.
                  További résztvevőket a várószobában lehet meghívni.
                </Typography>
                <Button
                  variant="contained"
                  onClick={() => void handleCreateShift()}
                  disabled={isSubmitting || !selectedBuilding}
                >
                  {isSubmitting ? "Létrehozás..." : "Műszak létrehozása"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </Box>
    </Layout>
  );
}
