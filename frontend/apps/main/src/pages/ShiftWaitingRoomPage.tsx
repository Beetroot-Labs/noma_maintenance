import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Check, CloudDownload, LoaderCircle, Plus, Trash, UserPlus, X } from "lucide-react";
import {
  rebuildBuildingSnapshot,
} from "@noma/shared";
import { Layout } from "@/components/Layout";
import { useDemoUser } from "@/context/DemoUserContext";
import { useShift } from "@/context/ShiftContext";
import { pruneNonRetryableMaintenanceSyncItems } from "@/lib/maintenanceStore";

type ShiftParticipant = {
  user_id: string;
  full_name: string;
  email: string;
  status: string;
  invited_at: string;
  accepted_at: string | null;
  cache_ready_at: string | null;
};

type ShiftWaitingRoomPayload = {
  id: string;
  status: string;
  building_id: string;
  building_name: string;
  lead_user_id: string;
  lead_user_name: string;
  my_participant_status: string;
  participants: ShiftParticipant[];
};

type InviteCandidate = {
  id: string;
  full_name: string;
  email: string;
  role: string;
};

const statusLabel: Record<string, string> = {
  INVITED: "Meghívva",
  ACCEPTED: "Elfogadva",
  CACHE_READY: "Cache kész",
  DECLINED: "Elutasítva",
  CLOSE_CONFIRMED: "Lezárás megerősítve",
};

const participantStatusIcon = (status: string) => {
  const normalizedStatus = status.trim().toUpperCase();
  switch (normalizedStatus) {
    case "INVITED":
      return (
        <Box
          aria-label={statusLabel.INVITED}
          sx={{
            display: "inline-flex",
            "@keyframes waiting-room-spin": {
              from: { transform: "rotate(0deg)" },
              to: { transform: "rotate(720deg)" },
            },
            animation: "waiting-room-spin 1.2s ease infinite",
          }}
        >
          <LoaderCircle size={18} />
        </Box>
      );
    case "ACCEPTED":
      return (
        <Box aria-label={statusLabel.ACCEPTED} sx={{ display: "inline-flex", color: "text.secondary" }}>
          <CloudDownload size={18} />
        </Box>
      );
    case "CACHE_READY":
      return (
        <Box aria-label={statusLabel.CACHE_READY} sx={{ display: "inline-flex", color: "success.main" }}>
          <Check size={18} />
        </Box>
      );
    case "DECLINED":
      return (
        <Box aria-label={statusLabel.DECLINED} sx={{ display: "inline-flex", color: "error.main" }}>
          <X size={18} />
        </Box>
      );
    default:
      return null;
  }
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

export default function ShiftWaitingRoomPage() {
  const navigate = useNavigate();
  const { shiftId } = useParams<{ shiftId: string }>();
  const { user } = useDemoUser();
  const { refreshCurrentShift } = useShift();
  const [payload, setPayload] = useState<ShiftWaitingRoomPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isCaching, setIsCaching] = useState(false);
  const [isStartingShift, setIsStartingShift] = useState(false);
  const [isCancellingShift, setIsCancellingShift] = useState(false);
  const [isAddingParticipant, setIsAddingParticipant] = useState(false);
  const [isRemovingParticipantId, setIsRemovingParticipantId] = useState<string | null>(null);
  const [addParticipantOpen, setAddParticipantOpen] = useState(false);
  const [inviteCandidates, setInviteCandidates] = useState<InviteCandidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<InviteCandidate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoCacheTriggeredRef = useRef(false);

  const loadWaitingRoom = useCallback(async () => {
    if (!shiftId) {
      return;
    }
    const response = await fetch(`/api/shifts/${shiftId}/waiting-room`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(await readApiErrorMessage(response, "Nem sikerült betölteni a várószobát."));
    }
    const nextPayload = (await response.json()) as ShiftWaitingRoomPayload;
    setPayload(nextPayload);
  }, [shiftId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        await loadWaitingRoom();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Nem sikerült betölteni a várószobát.");
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
  }, [loadWaitingRoom]);

  useEffect(() => {
    if (!payload || !user) {
      return;
    }
    if (payload.status === "IN_PROGRESS") {
      void refreshCurrentShift().finally(() => {
        navigate("/dashboard");
      });
      return;
    }
    if (payload.my_participant_status !== "ACCEPTED") {
      autoCacheTriggeredRef.current = false;
      return;
    }
    if (autoCacheTriggeredRef.current || isCaching) {
      return;
    }

    autoCacheTriggeredRef.current = true;
    setIsCaching(true);
    setError(null);

    const run = async () => {
      try {
        await pruneNonRetryableMaintenanceSyncItems();
        await rebuildBuildingSnapshot(user.tenantId, payload.building_id);
        const ackResponse = await fetch(`/api/shifts/${payload.id}/cache-ready`, {
          method: "POST",
          credentials: "include",
        });
        if (!ackResponse.ok) {
          throw new Error(
            await readApiErrorMessage(
              ackResponse,
              "A cache kész állapot jelzése sikertelen volt.",
            ),
          );
        }
        await loadWaitingRoom();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Nem sikerült a cache szinkron.");
        autoCacheTriggeredRef.current = false;
      } finally {
        setIsCaching(false);
      }
    };

    void run();
  }, [isCaching, loadWaitingRoom, navigate, payload, refreshCurrentShift, user]);

  const handleAccept = async () => {
    if (!shiftId) {
      return;
    }
    setIsAccepting(true);
    setError(null);
    try {
      const response = await fetch(`/api/shifts/${shiftId}/accept`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, "Nem sikerült elfogadni a meghívást."));
      }
      await refreshCurrentShift();
      await loadWaitingRoom();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nem sikerült elfogadni a meghívást.");
    } finally {
      setIsAccepting(false);
    }
  };

  const handleStartShift = async () => {
    if (!payload) {
      return;
    }
    setIsStartingShift(true);
    setError(null);
    try {
      const response = await fetch(`/api/shifts/${payload.id}/start`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, "Nem sikerült elindítani a műszakot."));
      }
      await refreshCurrentShift();
      await loadWaitingRoom();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nem sikerült elindítani a műszakot.");
    } finally {
      setIsStartingShift(false);
    }
  };

  const handleCancelShift = async () => {
    if (!payload) {
      return;
    }
    setIsCancellingShift(true);
    setError(null);
    try {
      const response = await fetch(`/api/shifts/${payload.id}/cancel`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, "Nem sikerült megszakítani a műszakot."));
      }
      await refreshCurrentShift();
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nem sikerült megszakítani a műszakot.");
    } finally {
      setIsCancellingShift(false);
    }
  };

  const handleOpenAddParticipant = async () => {
    setError(null);
    setAddParticipantOpen(true);
    try {
      const response = await fetch("/api/users/invite-candidates", {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, "Nem sikerült betölteni a felhasználókat."));
      }
      const payload = (await response.json()) as InviteCandidate[];
      setInviteCandidates(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nem sikerült betölteni a felhasználókat.");
    }
  };

  const handleAddParticipant = async () => {
    if (!payload || !selectedCandidate) {
      return;
    }
    setIsAddingParticipant(true);
    setError(null);
    try {
      const response = await fetch(`/api/shifts/${payload.id}/participants`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: selectedCandidate.id }),
      });
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, "Nem sikerült hozzáadni a résztvevőt."));
      }
      setAddParticipantOpen(false);
      setSelectedCandidate(null);
      await loadWaitingRoom();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nem sikerült hozzáadni a résztvevőt.");
    } finally {
      setIsAddingParticipant(false);
    }
  };

  const handleRemoveParticipant = async (participantUserId: string) => {
    if (!payload) {
      return;
    }
    setIsRemovingParticipantId(participantUserId);
    setError(null);
    try {
      const response = await fetch(
        `/api/shifts/${payload.id}/participants/${participantUserId}`,
        {
          method: "DELETE",
          credentials: "include",
        },
      );
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, "Nem sikerült eltávolítani a résztvevőt."));
      }
      await loadWaitingRoom();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nem sikerült eltávolítani a résztvevőt.");
    } finally {
      setIsRemovingParticipantId(null);
    }
  };

  const isShiftLead = Boolean(user && payload && user.id === payload.lead_user_id);
  const allParticipantsCacheReady = Boolean(
    payload && payload.participants.every((participant) => participant.status === "CACHE_READY"),
  );
  const invitableCandidates = payload
    ? inviteCandidates.filter(
        (candidate) =>
          !payload.participants.some((participant) => participant.user_id === candidate.id),
      )
    : inviteCandidates;

  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          Műszak várószoba
        </Typography>

        {error ? <Alert severity="error">{error}</Alert> : null}

        {isLoading || !payload ? (
          <Box sx={{ py: 6, display: "grid", placeItems: "center" }}>
            <CircularProgress color="secondary" />
          </Box>
        ) : (
          <Stack spacing={2}>
            <Card>
              <CardContent sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  {payload.building_name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Műszakvezető: {payload.lead_user_name}
                </Typography>
                <Stack direction="row" spacing={1}>
                  <Chip label={`Műszak: ${statusLabel[payload.status] ?? payload.status}`} />
                  <Chip
                    color={payload.my_participant_status === "CACHE_READY" ? "success" : "default"}
                    label={`Státuszom: ${statusLabel[payload.my_participant_status] ?? payload.my_participant_status}`}
                  />
                </Stack>
                {payload.my_participant_status === "INVITED" ? (
                  <Box sx={{ pt: 1 }}>
                    <Button variant="contained" onClick={() => void handleAccept()} disabled={isAccepting}>
                      {isAccepting ? "Elfogadás..." : "Meghívás elfogadása"}
                    </Button>
                  </Box>
                ) : null}
                {payload.my_participant_status === "ACCEPTED" ? (
                  <Typography variant="body2" color="text.secondary">
                    {isCaching ? "Offline adatok gyorsítótárazása folyamatban..." : "Offline adatok előkészítése..."}
                  </Typography>
                ) : null}
                {isShiftLead ? (
                  <Stack direction="row" spacing={1.25} sx={{ pt: 1, flexWrap: "wrap" }}>
                    <Button
                      variant="outlined"
                      color="error"
                      onClick={() => void handleCancelShift()}
                      disabled={isCancellingShift || isStartingShift}
                    >
                      {isCancellingShift ? "Megszakítás..." : "Megszakítás"}
                    </Button>
                    <Button
                      variant="contained"
                      onClick={() => void handleStartShift()}
                      disabled={
                        isStartingShift ||
                        isCancellingShift ||
                        !allParticipantsCacheReady ||
                        payload.status === "IN_PROGRESS" ||
                        payload.status === "CANCELLED"
                      }
                    >
                      {isStartingShift ? "Indítás..." : "Műszak indítása"}
                    </Button>
                  </Stack>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>
                  Résztvevők
                </Typography>
                <List disablePadding>
                  {payload.participants.map((participant) => (
                    <ListItem key={participant.user_id} divider>
                      <Box sx={{ display: "inline-flex", alignItems: "center", mr: 1.25 }}>
                        {participantStatusIcon(participant.status)}
                      </Box>
                      <ListItemText
                        primary={participant.full_name}
                        secondary={participant.email}
                      />
                      {isShiftLead && participant.user_id !== payload.lead_user_id ? (
                        <IconButton
                          color="error"
                          onClick={() => void handleRemoveParticipant(participant.user_id)}
                          disabled={isRemovingParticipantId === participant.user_id}
                          aria-label="Résztvevő eltávolítása"
                        >
                          <Trash size={16} />
                        </IconButton>
                      ) : null}
                    </ListItem>
                  ))}
                  {isShiftLead &&
                      <ListItem sx={{ color: "text.secondary" }}>
                        <Button
                          variant="text"
                          onClick={() => void handleOpenAddParticipant()}
                          startIcon={<UserPlus size={16} />}
                          sx={{ textTransform: "none" }}
                        >
                          Résztvevő hozzáadása
                        </Button>
                    </ListItem>}
                </List>
              </CardContent>
            </Card>
          </Stack>
        )}
      </Box>

      <Dialog open={addParticipantOpen} onClose={() => setAddParticipantOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Résztvevő hozzáadása</DialogTitle>
        <DialogContent>
          <Autocomplete
            sx={{ mt: 1 }}
            options={invitableCandidates}
            value={selectedCandidate}
            onChange={(_, value) => setSelectedCandidate(value)}
            getOptionLabel={(option) => `${option.full_name} (${option.email})`}
            renderInput={(params) => (
              <TextField {...params} label="Felhasználó" placeholder="Válassz felhasználót" />
            )}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddParticipantOpen(false)}>Mégse</Button>
          <Button
            variant="contained"
            onClick={() => void handleAddParticipant()}
            disabled={!selectedCandidate || isAddingParticipant}
          >
            {isAddingParticipant ? "Hozzáadás..." : "Hozzáadás"}
          </Button>
        </DialogActions>
      </Dialog>
    </Layout>
  );
}
