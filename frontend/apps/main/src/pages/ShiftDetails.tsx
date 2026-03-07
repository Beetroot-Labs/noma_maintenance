import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Card,
  CardContent,
  CircularProgress,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Typography,
} from "@mui/material";
import { ArrowLeft, Building2, HardHat, Phone } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { appColors } from "@/theme";

type CurrentShiftSummary = {
  id: string;
  status: "INVITING" | "READY_TO_START" | "IN_PROGRESS";
  building_name: string;
  lead_user_name: string;
  lead_user_phone: string | null;
  my_participant_status: "INVITED" | "ACCEPTED" | "CACHE_READY" | "DECLINED" | "CLOSE_CONFIRMED";
};

type ShiftParticipant = {
  user_id: string;
  full_name: string;
  email: string;
  phone_number: string | null;
  status: string;
};

type ShiftWaitingRoomPayload = {
  id: string;
  status: string;
  building_id: string;
  building_name: string;
  building_address: string;
  lead_user_id: string;
  lead_user_name: string;
  lead_user_phone: string | null;
  my_participant_status: string;
  participants: ShiftParticipant[];
};

const readApiErrorMessage = async (response: Response, fallback: string) => {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // Ignore malformed payload.
  }
  return fallback;
};

export default function ShiftDetails() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<ShiftWaitingRoomPayload | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const currentShiftResponse = await fetch("/api/shifts/current", {
          credentials: "include",
          cache: "no-store",
        });
        if (!currentShiftResponse.ok) {
          throw new Error(
            await readApiErrorMessage(currentShiftResponse, "Nem sikerült betölteni a műszakot."),
          );
        }
        const currentShiftPayload = (await currentShiftResponse.json()) as {
          shift: CurrentShiftSummary | null;
        };

        if (!currentShiftPayload.shift) {
          if (!cancelled) {
            setPayload(null);
          }
          return;
        }

        const waitingRoomResponse = await fetch(
          `/api/shifts/${currentShiftPayload.shift.id}/waiting-room`,
          {
            credentials: "include",
            cache: "no-store",
          },
        );
        if (!waitingRoomResponse.ok) {
          throw new Error(
            await readApiErrorMessage(
              waitingRoomResponse,
              "Nem sikerült betölteni a műszak részleteit.",
            ),
          );
        }
        const waitingRoomPayload = (await waitingRoomResponse.json()) as ShiftWaitingRoomPayload;
        if (!cancelled) {
          setPayload(waitingRoomPayload);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Nem sikerült betölteni a műszak részleteit.",
          );
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

  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <IconButton
            onClick={() => navigate(-1)}
            aria-label="Vissza"
          >
            <ArrowLeft size={18} />
          </IconButton>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Műszak
          </Typography>
        </Box>

        {error ? <Alert severity="error">{error}</Alert> : null}

        {isLoading ? (
          <Box sx={{ py: 6, display: "grid", placeItems: "center" }}>
            <CircularProgress color="secondary" />
          </Box>
        ) : !payload ? (
          <Alert severity="info">Nincs aktív műszak.</Alert>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            {(() => {
              const orderedParticipants = [...payload.participants].sort((a, b) => {
                if (a.user_id === payload.lead_user_id) {
                  return -1;
                }
                if (b.user_id === payload.lead_user_id) {
                  return 1;
                }
                return a.full_name.localeCompare(b.full_name, "hu-HU");
              });

              return (
                <>
            <Card
              sx={{
                boxShadow: "none",
                bgcolor: "transparent",
                color: appColors.foreground,
              }}
            >
              <CardContent>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 0.5 }}>
                    <Building2 size={18} />
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      {payload.building_name}
                    </Typography>
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ pl: 4 }}>
                  {payload.building_address}
                </Typography>
              </CardContent>
            </Card>

            <Card
              sx={{
                boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)",
                bgcolor: appColors.card,
                color: appColors.foreground,
                border: `1px solid ${appColors.border}`,
              }}
            >
              <CardContent sx={{ pb: "8px !important" }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                  Résztvevők
                </Typography>
                <List disablePadding>
                  {orderedParticipants.map((participant) => {
                    const isLead = participant.user_id === payload.lead_user_id;
                    const callNumber = participant.phone_number ?? (isLead ? payload.lead_user_phone : null);
                    return (
                    <ListItem
                      key={participant.user_id}
                      disableGutters
                      secondaryAction={
                        callNumber ? (
                          <IconButton
                            component="a"
                            href={`tel:${callNumber}`}
                            aria-label={`${participant.full_name} hívása`}
                            sx={{ color: "primary.main" }}
                          >
                            <Phone size={18} />
                          </IconButton>
                        ) : null
                      }
                    >
                      <ListItemText
                        primary={
                          <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
                            {isLead ? <HardHat size={16} color={appColors.primary} /> : null}
                            <Typography
                              component="span"
                              sx={{ fontWeight: isLead ? 700 : 500, color: isLead ? "primary.main" : "text.primary" }}
                            >
                              {participant.full_name}
                            </Typography>
                          </Box>
                        }
                        secondary={
                          isLead ? (
                            <Typography variant="caption" color="text.secondary">
                              Műszakvezető
                            </Typography>
                          ) : null
                        }
                      />
                    </ListItem>
                    );
                  })}
                </List>
              </CardContent>
            </Card>
                </>
              );
            })()}
          </Box>
        )}
      </Box>
    </Layout>
  );
}
