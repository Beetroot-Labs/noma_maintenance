import { useEffect, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Menu,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import { cacheBuildingSnapshot, fetchBuildingCachePayload, getCachedBuildingSnapshot } from "@noma/shared";
import { ArrowLeft, Building2, CloudDownload, EllipsisVertical, HardHat, LoaderCircle, Phone, UserPlus, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { useDemoUser } from "@/context/DemoUserContext";
import { toast } from "@/lib/toast";
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

type InviteCandidate = {
  id: string;
  full_name: string;
  email: string;
  role: string;
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

const statusLabel: Record<string, string> = {
  INVITED: "Meghívva",
  ACCEPTED: "Elfogadva",
  DECLINED: "Elutasítva",
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
            "@keyframes shift-details-spin": {
              from: { transform: "rotate(0deg)" },
              to: { transform: "rotate(720deg)" },
            },
            animation: "shift-details-spin 1.2s ease infinite",
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

const backendUnavailableMessage = "A backend jelenleg nem elérhető, ezért a művelet nem hajtható végre.";

const toActionErrorMessage = (err: unknown, fallback: string) => {
  if (err instanceof TypeError) {
    return backendUnavailableMessage;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return fallback;
};

export default function ShiftDetails() {
  const navigate = useNavigate();
  const { user } = useDemoUser();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<ShiftWaitingRoomPayload | null>(null);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [addParticipantOpen, setAddParticipantOpen] = useState(false);
  const [inviteCandidates, setInviteCandidates] = useState<InviteCandidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<InviteCandidate | null>(null);
  const [isAddingParticipant, setIsAddingParticipant] = useState(false);
  const [isCancellingShift, setIsCancellingShift] = useState(false);
  const [isReloadingCache, setIsReloadingCache] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [actionsMenuAnchor, setActionsMenuAnchor] = useState<null | HTMLElement>(null);

  const isShiftLead = Boolean(user && payload && user.id === payload.lead_user_id);
  const isActionsMenuOpen = Boolean(actionsMenuAnchor);

  useEffect(() => {
    const markOnline = () => setIsOnline(true);
    const markOffline = () => setIsOnline(false);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, []);

  const loadShiftDetails = async (): Promise<ShiftWaitingRoomPayload | null> => {
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
      return null;
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
    return waitingRoomPayload;
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const nextPayload = await loadShiftDetails();
        if (!cancelled) {
          setPayload(nextPayload);
          setError(null);
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

  const loadInviteCandidates = async () => {
    const response = await fetch("/api/users/invite-candidates", {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(await readApiErrorMessage(response, "Nem sikerült betölteni a felhasználókat."));
    }
    const nextCandidates = (await response.json()) as InviteCandidate[];
    setInviteCandidates(nextCandidates);
  };

  const handleOpenAddParticipant = async () => {
    if (!isOnline) {
      toast.error(backendUnavailableMessage);
      return;
    }

    setAddParticipantOpen(true);
    setSelectedCandidate(null);
    try {
      await loadInviteCandidates();
    } catch (err) {
      const message = toActionErrorMessage(err, backendUnavailableMessage);
      toast.error(message);
    }
  };

  const handleAddParticipant = async () => {
    if (!payload || !selectedCandidate) {
      return;
    }
    if (!isOnline) {
      toast.error(backendUnavailableMessage);
      return;
    }

    setIsAddingParticipant(true);
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
      const nextPayload = await loadShiftDetails();
      setPayload(nextPayload);
    } catch (err) {
      const message = toActionErrorMessage(err, backendUnavailableMessage);
      toast.error(message);
    } finally {
      setIsAddingParticipant(false);
    }
  };

  const handleCancelShift = async () => {
    if (!payload) {
      return;
    }
    if (!isOnline) {
      toast.error(backendUnavailableMessage);
      return;
    }

    setIsCancellingShift(true);
    try {
      const response = await fetch(`/api/shifts/${payload.id}/cancel`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, "Nem sikerült megszakítani a műszakot."));
      }
      toast.success("A műszak megszakítása sikeres.");
      navigate("/");
    } catch (err) {
      const message = toActionErrorMessage(err, backendUnavailableMessage);
      toast.error(message);
    } finally {
      setIsCancellingShift(false);
      setCancelDialogOpen(false);
    }
  };

  const handleOpenActionsMenu = (event: React.MouseEvent<HTMLElement>) => {
    setActionsMenuAnchor(event.currentTarget);
  };

  const handleCloseActionsMenu = () => {
    setActionsMenuAnchor(null);
  };

  const handleOpenCancelDialog = () => {
    handleCloseActionsMenu();
    setCancelDialogOpen(true);
  };

  const handleReloadBuildingCache = async () => {
    if (!payload || !user) {
      return;
    }
    if (!isOnline) {
      toast.error(backendUnavailableMessage);
      return;
    }

    setIsReloadingCache(true);
    handleCloseActionsMenu();
    try {
      const cachePayload = await fetchBuildingCachePayload(payload.building_id);
      const previousSnapshot = await getCachedBuildingSnapshot(user.tenantId, payload.building_id);
      await cacheBuildingSnapshot(user.tenantId, payload.building_id, cachePayload, {
        previousSnapshot: previousSnapshot ?? undefined,
      });
      toast.success("Berendezés adatok sikeresen újratöltve.");
    } catch (err) {
      const message = toActionErrorMessage(err, backendUnavailableMessage);
      toast.error(message);
    } finally {
      setIsReloadingCache(false);
    }
  };

  const invitableCandidates = payload
    ? inviteCandidates.filter(
        (candidate) =>
          !payload.participants.some((participant) => participant.user_id === candidate.id),
      )
    : inviteCandidates;

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
          <Box sx={{ ml: "auto" }}>
            <IconButton
              aria-label="Műveletek"
              onClick={handleOpenActionsMenu}
              disabled={!isOnline || isAddingParticipant || isCancellingShift || isReloadingCache}
            >
              <EllipsisVertical size={18} />
            </IconButton>
          </Box>
          <Menu
            anchorEl={actionsMenuAnchor}
            open={isActionsMenuOpen}
            onClose={handleCloseActionsMenu}
          >
            <MenuItem
              onClick={() => void handleReloadBuildingCache()}
              disabled={!isOnline || isReloadingCache}
            >
              Berendezés adatok újratöltése
            </MenuItem>
            {isShiftLead ? (
              <MenuItem
                onClick={handleOpenCancelDialog}
                disabled={!isOnline || isCancellingShift || isAddingParticipant || isReloadingCache}
              >
                Műszak megszakítása
              </MenuItem>
            ) : null}
          </Menu>
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
                            {participantStatusIcon(participant.status)}
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
                {isShiftLead ? (
                  <Button
                    variant="text"
                    disabled={!isOnline || isAddingParticipant || isCancellingShift}
                    onClick={() => void handleOpenAddParticipant()}
                    startIcon={<UserPlus size={16} />}
                    sx={{ mt: 0.5, textTransform: "none" }}
                  >
                    Résztvevő hozzáadása
                  </Button>
                ) : null}
              </CardContent>
            </Card>
                </>
              );
            })()}
          </Box>
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
            disabled={!selectedCandidate || isAddingParticipant || !isOnline}
          >
            {isAddingParticipant ? "Hozzáadás..." : "Hozzáadás"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={cancelDialogOpen} onClose={() => setCancelDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Figyelem</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Biztosan meg akarod szakítani a jelenlegi műszakot? Megszakítás esetén minden, a
            műszakhoz kapcsolódó adat el fog veszni.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCancelDialogOpen(false)}>Mégse</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => void handleCancelShift()}
            disabled={isCancellingShift || !isOnline}
          >
            {isCancellingShift ? "Megszakítás..." : "Igen, megszakítom"}
          </Button>
        </DialogActions>
      </Dialog>
    </Layout>
  );
}
