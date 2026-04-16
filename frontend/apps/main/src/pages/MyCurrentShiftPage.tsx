import { useCallback, useEffect, useState } from "react";
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
import {
  rebuildBuildingSnapshot,
} from "@noma/shared";
import {
  ArrowLeft,
  Building2,
  Check,
  CloudDownload,
  CloudUpload,
  EllipsisVertical,
  HardHat,
  LoaderCircle,
  Phone,
  Repeat,
  Trash,
  UserPlus,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { useDemoUser } from "@/context/DemoUserContext";
import { useShift } from "@/context/ShiftContext";
import { pruneNonRetryableMaintenanceSyncItems } from "@/lib/maintenanceStore";
import { toast } from "@/lib/toast";
import { appColors } from "@/theme";

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

const shiftDetailsStorageKey = (userId: string) => `noma:shift-details:${userId}`;

const loadStoredShiftDetails = (userId: string): ShiftWaitingRoomPayload | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(shiftDetailsStorageKey(userId));
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as ShiftWaitingRoomPayload;
  } catch {
    return null;
  }
};

const storeShiftDetails = (userId: string, payload: ShiftWaitingRoomPayload | null) => {
  if (typeof window === "undefined") {
    return;
  }

  if (!payload) {
    window.localStorage.removeItem(shiftDetailsStorageKey(userId));
    return;
  }

  window.localStorage.setItem(shiftDetailsStorageKey(userId), JSON.stringify(payload));
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

const participantSyncIcon = (shiftStatus: string, participantStatus: string) => {
  if (shiftStatus !== "CLOSE_REQUESTED" && shiftStatus !== "READY_TO_COMMIT") {
    return null;
  }

  const normalizedStatus = participantStatus.trim().toUpperCase();
  if (normalizedStatus === "CLOSE_CONFIRMED") {
    return (
      <Box
        aria-label="Szinkron megerősítve"
        sx={{ display: "inline-flex", color: "success.main" }}
      >
        <Check size={18} />
      </Box>
    );
  }

  return (
    <Box
      aria-label="Szinkron megerősítésre vár"
      sx={{ display: "inline-flex", color: "text.secondary" }}
    >
      <CloudUpload size={18} />
    </Box>
  );
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

export default function MyCurrentShiftPage() {
  const navigate = useNavigate();
  const { user } = useDemoUser();
  const { currentShift, refreshCurrentShift } = useShift();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<ShiftWaitingRoomPayload | null>(null);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [addParticipantOpen, setAddParticipantOpen] = useState(false);
  const [inviteCandidates, setInviteCandidates] = useState<InviteCandidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<InviteCandidate | null>(null);
  const [isAddingParticipant, setIsAddingParticipant] = useState(false);
  const [isCancellingShift, setIsCancellingShift] = useState(false);
  const [isClosingShift, setIsClosingShift] = useState(false);
  const [isReloadingCache, setIsReloadingCache] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [actionsMenuAnchor, setActionsMenuAnchor] = useState<null | HTMLElement>(null);
  const [participantActionKey, setParticipantActionKey] = useState<string | null>(null);

  const isShiftLead = Boolean(user && payload && user.id === payload.lead_user_id);
  const isActionsMenuOpen = Boolean(actionsMenuAnchor);
  const areAllParticipantsConfirmed = Boolean(
    payload &&
      payload.participants
        .filter((participant) => participant.status !== "DECLINED")
        .every((participant) => participant.status === "CLOSE_CONFIRMED"),
  );

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

  const loadShiftDetails = useCallback(async (): Promise<ShiftWaitingRoomPayload | null> => {
    const shiftId = currentShift?.id;
    if (!shiftId) {
      return null;
    }

    const waitingRoomResponse = await fetch(
      `/api/shifts/${shiftId}/waiting-room`,
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
    if (user?.id) {
      storeShiftDetails(user.id, waitingRoomPayload);
    }
    return waitingRoomPayload;
  }, [currentShift?.id, user?.id]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (user?.id) {
        const storedPayload = loadStoredShiftDetails(user.id);
        if (!cancelled && storedPayload && currentShift?.id === storedPayload.id) {
          setPayload(storedPayload);
          setError(null);
          setIsLoading(false);
        }
      }

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
          const storedPayload = user?.id ? loadStoredShiftDetails(user.id) : null;
          if (storedPayload && currentShift?.id === storedPayload.id) {
            setPayload(storedPayload);
            setError(null);
          } else {
            setError(
              err instanceof Error ? err.message : "Nem sikerült betölteni a műszak részleteit.",
            );
          }
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
  }, [currentShift?.id, currentShift?.status, loadShiftDetails, user?.id]);

  useEffect(() => {
    if (
      !currentShift?.id ||
      !(
        payload?.participants.some((participant) => participant.status === "INVITED") ||
        currentShift.status === "CLOSE_REQUESTED" ||
        currentShift.status === "READY_TO_COMMIT"
      ) ||
      !isOnline
    ) {
      return;
    }

    let disposed = false;
    let isRefreshing = false;
    const eventSource = new EventSource(`/api/shifts/${currentShift.id}/events`);

    const refreshFromServer = () => {
      if (isRefreshing || disposed) {
        return;
      }

      isRefreshing = true;
      void (async () => {
        try {
          await refreshCurrentShift();
          const nextPayload = await loadShiftDetails();
          if (!disposed) {
            setPayload(nextPayload);
            setError(null);
          }
        } catch (err) {
          if (!disposed) {
            setError(
              err instanceof Error ? err.message : "Nem sikerült frissíteni a műszak részleteit.",
            );
          }
        } finally {
          isRefreshing = false;
        }
      })();
    };

    const handleParticipantsUpdated = () => {
      refreshFromServer();
    };

    eventSource.addEventListener("participants-updated", handleParticipantsUpdated);
    eventSource.onerror = () => {
      if (!disposed) {
        setError(null);
      }
    };

    return () => {
      disposed = true;
      eventSource.removeEventListener("participants-updated", handleParticipantsUpdated);
      eventSource.close();
    };
  }, [currentShift?.id, isOnline, loadShiftDetails, payload?.participants, refreshCurrentShift]);

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
      if (user?.id) {
        storeShiftDetails(user.id, nextPayload);
      }
    } catch (err) {
      const message = toActionErrorMessage(err, backendUnavailableMessage);
      toast.error(message);
    } finally {
      setIsAddingParticipant(false);
    }
  };

  const refreshParticipantPayload = async () => {
    const nextPayload = await loadShiftDetails();
    setPayload(nextPayload);
    if (user?.id) {
      storeShiftDetails(user.id, nextPayload);
    }
  };

  const handleReinviteParticipant = async (participantUserId: string) => {
    if (!payload) {
      return;
    }
    if (!isOnline) {
      toast.error(backendUnavailableMessage);
      return;
    }

    setParticipantActionKey(`reinvite:${participantUserId}`);
    try {
      const response = await fetch(`/api/shifts/${payload.id}/participants`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: participantUserId }),
      });
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, "Nem sikerült újra meghívni a résztvevőt."));
      }
      await refreshParticipantPayload();
    } catch (err) {
      const message = toActionErrorMessage(err, backendUnavailableMessage);
      toast.error(message);
    } finally {
      setParticipantActionKey(null);
    }
  };

  const handleRemoveParticipant = async (participantUserId: string) => {
    if (!payload) {
      return;
    }
    if (!isOnline) {
      toast.error(backendUnavailableMessage);
      return;
    }

    setParticipantActionKey(`remove:${participantUserId}`);
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
      await refreshParticipantPayload();
    } catch (err) {
      const message = toActionErrorMessage(err, backendUnavailableMessage);
      toast.error(message);
    } finally {
      setParticipantActionKey(null);
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
      await refreshCurrentShift();
      toast.success("A műszak megszakítása sikeres.");
      navigate("/home");
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

  const handleOpenCloseDialog = () => {
    setCloseDialogOpen(true);
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
      await pruneNonRetryableMaintenanceSyncItems();
      await rebuildBuildingSnapshot(user.tenantId, payload.building_id);
      toast.success("Berendezés adatok sikeresen újratöltve.");
    } catch (err) {
      const message = toActionErrorMessage(err, backendUnavailableMessage);
      toast.error(message);
    } finally {
      setIsReloadingCache(false);
    }
  };

  const handleCloseShift = async () => {
    if (!payload || !isShiftLead || !isOnline) {
      return;
    }

    setIsClosingShift(true);
    try {
      const response = await fetch(`/api/shifts/${payload.id}/close-request`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, "Nem sikerült lezárni a műszakot."));
      }
      await refreshCurrentShift();
      const nextPayload = await loadShiftDetails();
      setPayload(nextPayload);
      toast.success("A műszak lezárása kezdeményezve.");
    } catch (err) {
      const message = toActionErrorMessage(err, backendUnavailableMessage);
      toast.error(message);
    } finally {
      setIsClosingShift(false);
      setCloseDialogOpen(false);
    }
  };

  const invitableCandidates = payload
    ? inviteCandidates.filter(
        (candidate) =>
          !payload.participants.some(
            (participant) =>
              participant.user_id === candidate.id && participant.status !== "DECLINED",
          ),
      )
    : inviteCandidates;

  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
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
                     const canReinviteParticipant =
                       isShiftLead &&
                       !isLead &&
                       participant.status === "DECLINED" &&
                       payload.status !== "CLOSE_REQUESTED";
                     const canRemoveParticipant =
                       isShiftLead &&
                       !isLead &&
                       payload.status === "READY_TO_START";
                     const isReinvitingParticipant =
                       participantActionKey === `reinvite:${participant.user_id}`;
                     const isRemovingParticipant =
                       participantActionKey === `remove:${participant.user_id}`;
                     return (
                     <ListItem
                       key={participant.user_id}
                       disableGutters
                       secondaryAction={
                         <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                           {callNumber ? (
                             <IconButton
                               component="a"
                               href={`tel:${callNumber}`}
                               aria-label={`${participant.full_name} hívása`}
                               sx={{ color: "primary.main" }}
                             >
                               <Phone size={18} />
                             </IconButton>
                           ) : null}
                           {canReinviteParticipant ? (
                             <IconButton
                               onClick={() => void handleReinviteParticipant(participant.user_id)}
                               disabled={participantActionKey !== null}
                               aria-label="Résztvevő újrahívása"
                               sx={{ color: "primary.main" }}
                             >
                               <Repeat size={18} />
                             </IconButton>
                           ) : null}
                           {canRemoveParticipant ? (
                             <IconButton
                               onClick={() => void handleRemoveParticipant(participant.user_id)}
                               disabled={participantActionKey !== null}
                               aria-label="Résztvevő eltávolítása"
                               sx={{ color: "error.main" }}
                             >
                               <Trash size={18} />
                             </IconButton>
                           ) : null}
                         </Box>
                       }
                     >
                      <ListItemText
                        primary={
                          <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
                            {participantStatusIcon(participant.status)}
                            {participantSyncIcon(payload.status, participant.status)}
                            {isLead ? <HardHat size={16} color={appColors.primary} /> : null}
                            <Typography
                              component="span"
                              sx={{ fontWeight: isLead ? 700 : 500, color: isLead ? "primary.main" : "text.primary" }}
                            >
                              {participant.full_name}
                              {isReinvitingParticipant ? " (újrahívás...)" : null}
                              {isRemovingParticipant ? " (eltávolítás...)" : null}
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
            {isShiftLead && payload.status === "IN_PROGRESS" ? (
              <Button
                variant="contained"
                color="primary"
                fullWidth
                onClick={handleOpenCloseDialog}
                disabled={!isOnline || isClosingShift}
                sx={{ mt: 1 }}
              >
                {isClosingShift ? "Lezárás..." : "Műszak lezárása"}
              </Button>
            ) : null}
            {isShiftLead && payload.status === "CLOSE_REQUESTED" && !areAllParticipantsConfirmed ? (
              <Alert severity="info" sx={{ mt: 1 }}>
                A műszak lezárása folyamatban van. A műszak összegzéséhez minden résztvevő alkalmazásának szinkronizálnia kell. Új karbantartás nem kezdeményezhető.
              </Alert>
            ) : null}
            {isShiftLead && areAllParticipantsConfirmed ? (
              <Button
                variant="contained"
                color="primary"
                fullWidth
                onClick={() => navigate("/shift-summary")}
                disabled={!isOnline}
              >
                Műszak összegzése
              </Button>
            ) : null}
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

      <Dialog open={closeDialogOpen} onClose={() => setCloseDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Műszak lezárása</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Biztosan le akarod zárni a jelenlegi műszakot? Ha lezárod a műszakot, utána új
            karbantartás már nem indítható.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCloseDialogOpen(false)}>Mégse</Button>
          <Button
            variant="contained"
            onClick={() => void handleCloseShift()}
            disabled={isClosingShift || !isOnline}
          >
            {isClosingShift ? "Lezárás..." : "Igen, lezárom"}
          </Button>
        </DialogActions>
      </Dialog>
    </Layout>
  );
}
