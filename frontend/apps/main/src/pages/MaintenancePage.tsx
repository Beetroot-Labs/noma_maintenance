import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Box,
  Button,
  ButtonBase,
  Card,
  CardContent,
  CardHeader,
  IconButton,
  Menu,
  MenuItem,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  ArrowLeft,
  ArrowRightFromLine,
  ArrowRightToLine,
  CheckCircle,
  Blocks,
  Cpu,
  Info,
  MapPin,
  MoreVertical,
  Pencil,
} from "lucide-react";
import { getDeviceKindLabel } from "@noma/shared";
import { Layout } from "@/components/Layout";
import { PhotoGallery } from "@/components/PhotoGallery";
import { PhotoUpload } from "@/components/PhotoUpload";
import { StatusBadge } from "@/components/StatusBadge";
import { useMaintenance } from "@/context/MaintenanceContext";
import { useDemoUser } from "@/context/DemoUserContext";
import {
  followupServiceReasonLabels,
  followupServiceReasonOrder,
  type MaintenanceKind,
} from "@/types/maintenance";
import { appColors } from "@/theme";
import { formatDateTime } from "@/lib/date";
import { toast } from "@/lib/toast";
import { getDeviceKindIcon } from "@/lib/deviceKind";

const inlineFollowupReasons = followupServiceReasonOrder.filter((reason) => reason !== "OTHER");
const maintenanceKindLabels: Record<MaintenanceKind, string> = {
  ROUTINE: "Rutin karbantartás",
  SERVICE: "Szervíz",
};
const issueNumberTooltip =
  "Az igénylési számot a megbízótól kapott bejelentő emailben találod. Q123456";

export default function MaintenancePage() {
  const { workId } = useParams<{ workId: string }>();
  const navigate = useNavigate();
  const {
    todaysWorks,
    pastWorks,
    setMaintenanceKind,
    updateIssueNumber,
    updateNotes,
    addPhoto,
    setFollowupServiceRequired,
    toggleFollowupServiceReason,
    updateFollowupServiceReasonOther,
    completeMaintenance,
    abortMaintenance,
    markEdited,
    workdayClosed,
  } = useMaintenance();
  const { user } = useDemoUser();
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [isEditing, setIsEditing] = useState(false);

  const work =
    todaysWorks.find((item) => item.id === workId) ||
    pastWorks.find((item) => item.id === workId);
  const lastEditedLabel = work?.lastEdited ? formatDateTime(work.lastEdited) : null;

  if (!work) {
    return (
      <Layout>
        <Box sx={{ textAlign: "center", py: 8 }}>
          <Typography variant="body2" color="text.secondary">
            A munka nem található
          </Typography>
          <Button variant="text" onClick={() => navigate("/home")}>
            Vissza a kezdőlapra
          </Button>
        </Box>
      </Layout>
    );
  }

  const isCompleted = work.status === "completed";
  const isExecutor = user?.id === work.executorId;
  const isReadOnly = isCompleted || (work.status === "in-progress" && !isExecutor);
  const canEdit = !isReadOnly || (isCompleted && isExecutor && isEditing);
  const canShowMenu =
    isExecutor && (work.status === "in-progress" || (work.status === "completed" && !isEditing));
  const canShowEditOption = !workdayClosed && work.status === "completed" && !isEditing;
  const hasPhoto = work.photos.length > 0;
  const hasSelectedFollowupReason = work.followupServiceReasons.length > 0;
  const requiresOtherReason = work.followupServiceReasons.includes("OTHER");
  const hasOtherReason = work.followupServiceReasonOther.trim().length > 0;
  const requiresIssueNumber = work.maintenanceKind === "SERVICE";
  const hasIssueNumber = work.issueNumber.trim().length > 0;
  const requiresPhoto = !work.followupServiceRequired;
  const canCompleteMaintenance =
    (!requiresIssueNumber || hasIssueNumber) &&
    (!requiresPhoto || hasPhoto) &&
    (!work.followupServiceRequired ||
      (hasSelectedFollowupReason && (!requiresOtherReason || hasOtherReason)));

  const handleComplete = () => {
    if (requiresIssueNumber && !hasIssueNumber) {
      toast.error("Szervíz esetén az igénylési szám megadása kötelező.");
      return;
    }
    if (requiresPhoto && !hasPhoto) {
      toast.error("A befejezéshez legalább egy fotót töltsön fel");
      return;
    }
    if (work.followupServiceRequired && !hasSelectedFollowupReason) {
      toast.error("Jelöljön ki legalább egy okot a további szervízhez.");
      return;
    }
    if (requiresOtherReason && !hasOtherReason) {
      toast.error("Az Egyéb ok megadásához írjon be egy indoklást.");
      return;
    }

    completeMaintenance(work.id);
    toast.success("Karbantartás befejezve!");
    navigate("/shifts/current");
  };

  const handleAbort = () => {
    abortMaintenance(work.id);
    toast.info("A karbantartás megszakítva.");
    navigate("/shifts/current");
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setMenuAnchor(event.currentTarget);
  };

  const handleMenuClose = () => {
    setMenuAnchor(null);
  };

  const handleSaveEdits = () => {
    if (requiresIssueNumber && !hasIssueNumber) {
      toast.error("Szervíz esetén az igénylési szám megadása kötelező.");
      return;
    }
    markEdited(work.id);
    setIsEditing(false);
    toast.success("Módosítások elmentve.");
  };

  const kindLabel = getDeviceKindLabel(work.hvacKind);
  const KindIcon = getDeviceKindIcon(work.hvacKind);

  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3, animation: "slideUp 0.3s ease-out" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <IconButton onClick={() => navigate("/shifts/current")}>
            <ArrowLeft size={18} />
          </IconButton>
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, pb: 2 }}>
              <Box sx={{ color: appColors.primary }}>
              <KindIcon size={36} />
              </Box>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {work.hvacId}
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}>
              <StatusBadge status={work.status} />
            </Box>
          </Box>
          {canShowMenu && (
            <IconButton onClick={handleMenuOpen} aria-label="További lehetőségek">
              <MoreVertical size={18} />
            </IconButton>
          )}
        </Box>
        <Box
          sx={{
            display: "grid",
            gap: 3,
            gridTemplateColumns: { xs: "1fr", md: "1.1fr 0.9fr" },
            alignItems: "start",
          }}
        >
          <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
              <CardHeader title="Egység adatai" titleTypographyProps={{ variant: "subtitle1", fontWeight: 700 }} />
              <CardContent>
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: {
                      xs: "1fr",
                      md: lastEditedLabel ? "repeat(3, minmax(0, 1fr))" : "repeat(2, minmax(0, 1fr))",
                    },
                    gap: 0,
                  }}
                >
                  <Box sx={{ p: 1.5, borderRadius: 2 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                      <Box
                        sx={{
                          width: 32,
                          height: 32,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          bgcolor: "rgba(0, 0, 0, 0.08)",
                          borderRadius: 2,
                        }}
                      >
                        <Cpu size={18} color={appColors.primary} />
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Modell
                        </Typography>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {work.hvacModel}
                        </Typography>
                      </Box>
                    </Box>
                  </Box>
                  <Box sx={{ p: 1.5, borderRadius: 2 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                      <Box
                        sx={{
                          width: 32,
                          height: 32,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          bgcolor: "rgba(0, 0, 0, 0.08)",
                          borderRadius: 2,
                        }}
                      >
                        <Blocks size={18} color={appColors.primary} />
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Típus
                        </Typography>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {kindLabel}
                        </Typography>
                      </Box>
                    </Box>
                  </Box>
                  <Box sx={{ p: 1.5, borderRadius: 2 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                      <Box
                        sx={{
                          width: 32,
                          height: 32,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          bgcolor: "rgba(0, 0, 0, 0.08)",
                          borderRadius: 2,
                        }}
                      >
                        <MapPin size={18} color={appColors.primary} />
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Cím és helyszín
                        </Typography>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {work.hvacAddress}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {work.hvacLocation}
                        </Typography>
                      </Box>
                    </Box>
                  </Box>
                </Box>
              </CardContent>
            </Card>

            <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
              <CardHeader title="Karbantartás" titleTypographyProps={{ variant: "subtitle1", fontWeight: 700 }} />
              <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
                    gap: 0,
                  }}
                >
                  <Box sx={{ p: 1.5, borderRadius: 2 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                      <Box
                        sx={{
                          width: 32,
                          height: 32,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          bgcolor: "rgba(0, 0, 0, 0.08)",
                          borderRadius: 2,
                        }}
                      >
                        <ArrowRightFromLine size={18} color={appColors.primary} />
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Kezdete
                        </Typography>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {formatDateTime(work.startTime)}
                        </Typography>
                      </Box>
                    </Box>
                  </Box>
                  <Box sx={{ p: 1.5, borderRadius: 2 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                      <Box
                        sx={{
                          width: 32,
                          height: 32,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          bgcolor: "rgba(0, 0, 0, 0.08)",
                          borderRadius: 2,
                        }}
                      >
                        <ArrowRightToLine size={18} color={appColors.primary} />
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Befejezése
                        </Typography>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {work.endTime ? formatDateTime(work.endTime) : "-"}
                        </Typography>
                      </Box>
                    </Box>
                  </Box>
                  {lastEditedLabel && (
                    <Box sx={{ p: 1.5, borderRadius: 2 }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                        <Box
                          sx={{
                            width: 32,
                            height: 32,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            bgcolor: "rgba(0, 0, 0, 0.08)",
                            borderRadius: 2,
                          }}
                        >
                          <Pencil size={18} color={appColors.primary} />
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Legutóbb módosítva
                          </Typography>
                          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                            {lastEditedLabel}
                          </Typography>
                        </Box>
                      </Box>
                    </Box>
                  )}
                </Box>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    Munka jellege
                  </Typography>
                  <ToggleButtonGroup
                    exclusive
                    color="secondary"
                    value={work.maintenanceKind}
                    onChange={(_, value: MaintenanceKind | null) => {
                      if (!value || !canEdit) {
                        return;
                      }
                      setMaintenanceKind(work.id, value);
                    }}
                    aria-label="Munka jellege"
                    sx={{
                      width: { xs: "100%", sm: "auto" },
                      alignSelf: "flex-start",
                      "& .MuiToggleButtonGroup-grouped": {
                        textTransform: "none",
                        px: 1.5,
                      },
                    }}
                  >
                    <ToggleButton value="ROUTINE" disabled={!canEdit} sx={{ flex: 1 }}>
                      {maintenanceKindLabels.ROUTINE}
                    </ToggleButton>
                    <ToggleButton value="SERVICE" disabled={!canEdit} sx={{ flex: 1 }}>
                      {maintenanceKindLabels.SERVICE}
                    </ToggleButton>
                  </ToggleButtonGroup>
                  {requiresIssueNumber ? (
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          Igénylési szám
                        </Typography>
                        <Tooltip title={issueNumberTooltip}>
                          <Box
                            component="span"
                            sx={{ display: "inline-flex", color: "text.secondary", cursor: "help" }}
                          >
                            <Info size={16} />
                          </Box>
                        </Tooltip>
                      </Box>
                      <TextField
                        value={work.issueNumber}
                        onChange={(event) => updateIssueNumber(work.id, event.target.value)}
                        placeholder="Q123456"
                        disabled={!canEdit}
                        required
                        error={!hasIssueNumber}
                        helperText={!hasIssueNumber ? "Szervíz esetén kötelező." : " "}
                        fullWidth
                      />
                    </Box>
                  ) : null}
                </Box>
              </CardContent>
            </Card>
          </Box>

          <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {(canEdit || work.followupServiceRequired) && (
              <Card
                sx={{
                  boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)",
                  border: work.followupServiceRequired ? `1px solid ${appColors.warning}` : "none",
                  bgcolor: work.followupServiceRequired ? "rgba(245, 158, 11, 0.08)" : undefined,
                }}
              >
                <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        További szervíz szükséges
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Kapcsolja be, ha az egység további beavatkozást igényel.
                      </Typography>
                    </Box>
                    <Switch
                      checked={work.followupServiceRequired}
                      onChange={(_, checked) => setFollowupServiceRequired(work.id, checked)}
                      disabled={!canEdit}
                    />
                  </Box>
                  {work.followupServiceRequired ? (
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                      {canEdit ? (
                        <>
                          <ToggleButtonGroup
                            value={work.followupServiceReasons.filter((reason) => reason !== "OTHER")}
                            aria-label="További szervíz okai"
                            sx={{
                              display: "flex",
                              flexWrap: "wrap",
                              gap: 1,
                              "& .MuiToggleButtonGroup-grouped": {
                                borderRadius: "999px !important",
                                border: `1px solid ${appColors.border} !important`,
                                margin: "0 !important",
                              },
                            }}
                          >
                            {inlineFollowupReasons.map((reason) => (
                              <ToggleButton
                                key={reason}
                                value={reason}
                                selected={work.followupServiceReasons.includes(reason)}
                                onChange={() => toggleFollowupServiceReason(work.id, reason)}
                                disabled={!canEdit}
                                sx={{
                                  px: 1.5,
                                  py: 0.75,
                                  textTransform: "none",
                                  fontWeight: 600,
                                  color: "text.secondary",
                                  "&.Mui-selected": {
                                    bgcolor: "rgba(2, 50, 45, 0.12)",
                                    color: appColors.primary,
                                  },
                                  "&.Mui-selected:hover": {
                                    bgcolor: "rgba(2, 50, 45, 0.18)",
                                  },
                                }}
                              >
                                {followupServiceReasonLabels[reason]}
                              </ToggleButton>
                            ))}
                          </ToggleButtonGroup>
                          <ButtonBase
                            onClick={() => toggleFollowupServiceReason(work.id, "OTHER")}
                            disabled={!canEdit}
                            sx={{
                              alignSelf: "flex-start",
                              px: 1.5,
                              py: 1,
                              borderRadius: 3,
                              border: `1px dashed ${
                                requiresOtherReason ? appColors.warning : appColors.border
                              }`,
                              bgcolor: requiresOtherReason
                                ? "rgba(58, 120, 93, 0.12)"
                                : "rgba(15, 23, 42, 0.03)",
                              color: requiresOtherReason ? appColors.primary : "text.secondary",
                              fontWeight: 600,
                            }}
                          >
                            {requiresOtherReason ? "Egyéb kiválasztva" : "Egyéb"}
                          </ButtonBase>
                          {requiresOtherReason ? (
                            <TextField
                              label="Egyéb ok"
                              placeholder="Írja le, milyen további szervíz szükséges"
                              value={work.followupServiceReasonOther}
                              onChange={(event) =>
                                updateFollowupServiceReasonOther(work.id, event.target.value)
                              }
                              disabled={!canEdit}
                              required
                              fullWidth
                            />
                          ) : null}
                        </>
                      ) : (
                        <>
                          {work.followupServiceReasons.map((reason) => (
                            <Typography key={reason} variant="body2">
                              {followupServiceReasonLabels[reason]}
                            </Typography>
                          ))}
                          {requiresOtherReason && work.followupServiceReasonOther.trim() ? (
                            <Typography variant="body2" color="text.secondary">
                              Egyéb: {work.followupServiceReasonOther}
                            </Typography>
                          ) : null}
                        </>
                      )}
                    </Box>
                  ) : null}
                </CardContent>
              </Card>
            )}

            <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
              <CardHeader title="Megjegyzések" titleTypographyProps={{ variant: "subtitle1", fontWeight: 700 }} />
              <CardContent>
                {canEdit ? (
                  <TextField
                    placeholder="Írja le a megfigyeléseket, elvégzett feladatokat vagy talált problémákat..."
                    value={work.notes}
                    onChange={(event) => updateNotes(work.id, event.target.value)}
                    inputProps={{
                      autoComplete: "off",
                      autoCorrect: "off",
                      autoCapitalize: "off",
                      spellCheck: false,
                      style: { overflowY: "auto" },
                    }}
                    multiline
                    minRows={4}
                    maxRows={10}
                    fullWidth
                  />
                ) : (
                  <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: appColors.muted }}>
                    <Typography variant="body2" color="text.secondary">
                      {work.notes || "Nincs megjegyzés."}
                    </Typography>
                  </Box>
                )}
              </CardContent>
            </Card>

            <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
              <CardHeader
                disableTypography
                title={
                  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      Fotók
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {work.photos.length} feltöltve
                    </Typography>
                  </Box>
                }
              />
              <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <PhotoGallery photos={work.photos} />
                {canEdit && <PhotoUpload onPhotoAdd={(photo) => addPhoto(work.id, photo)} />}
              </CardContent>
            </Card>

            {!isReadOnly && !isCompleted && (
              <Button
                variant="contained"
                size="large"
                startIcon={<CheckCircle size={18} />}
                onClick={handleComplete}
                disabled={!canCompleteMaintenance}
                fullWidth
                sx={{
                  bgcolor: appColors.success,
                  color: appColors.successForeground,
                  "&:hover": { bgcolor: "hsl(142 72% 38%)" },
                }}
              >
                Karbantartás befejezése
              </Button>
            )}

            {isCompleted && isExecutor && isEditing && (
              <Button
                variant="contained"
                size="large"
                startIcon={<CheckCircle size={18} />}
                onClick={handleSaveEdits}
                fullWidth
                sx={{
                  bgcolor: appColors.success,
                  color: appColors.successForeground,
                  "&:hover": { bgcolor: "hsl(142 72% 38%)" },
                }}
              >
                Elmentem a módosításokat
              </Button>
            )}
          </Box>
        </Box>

        {canShowMenu && (
          <Menu
          anchorEl={menuAnchor}
          open={Boolean(menuAnchor)}
          onClose={handleMenuClose}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
        >
          {canShowEditOption && (
            <MenuItem
              onClick={() => {
                handleMenuClose();
                setIsEditing(true);
              }}
            >
              Utólagos szerkesztés
            </MenuItem>
          )}
          {work.status === "in-progress" && (
            <MenuItem
              onClick={() => {
                handleMenuClose();
                handleAbort();
              }}
              sx={{ color: appColors.destructive, fontWeight: 700 }}
            >
              Karbantartás megszakítása
            </MenuItem>
          )}
          </Menu>
        )}

        {!isCompleted &&
        ((requiresIssueNumber && !hasIssueNumber) ||
          (requiresPhoto && !hasPhoto) ||
          (work.followupServiceRequired && !hasSelectedFollowupReason) ||
          (requiresOtherReason && !hasOtherReason)) && (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
            {requiresIssueNumber && !hasIssueNumber
              ? "Szervíz esetén az igénylési szám megadása kötelező"
              : requiresPhoto && !hasPhoto
              ? "A munka lezárásához töltsön fel legalább egy fotót"
              : !hasSelectedFollowupReason
                ? "További szervíz esetén legalább egy ok megadása kötelező"
                : "Az Egyéb ok kitöltése kötelező a lezáráshoz"}
          </Typography>
        )}
      </Box>
    </Layout>
  );
}
