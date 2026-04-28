import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Fab,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Typography,
} from "@mui/material";
import { Plus, HardHat, Users, View, Wrench } from "lucide-react";
import { Layout } from "@/components/Layout";
import { toast } from "@/lib/toast";
import { appColors } from "@/theme";
import { useDemoUser } from "@/context/DemoUserContext";
import { UserFormDialog, type UserFormValues } from "./UserFormDialog";

type AdminUser = {
  id: string;
  full_name: string;
  role: string;
};

const roleIcon: Record<string, typeof HardHat> = {
  ADMIN: Users,
  LEAD_TECHNICIAN: HardHat,
  TECHNICIAN: Wrench,
  VIEWER: View,
};

const roleSections = [
  { role: "ADMIN", label: "Adminisztrátorok" },
  { role: "LEAD_TECHNICIAN", label: "Vezető technikusok" },
  { role: "TECHNICIAN", label: "Technikusok" },
  { role: "VIEWER", label: "Megtekintők" },
] as const;

const readApiErrorMessage = async (response: Response, fallback: string) => {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // Ignore JSON parsing errors and use fallback.
  }
  return fallback;
};

export default function UsersPage() {
  const navigate = useNavigate();
  const { user } = useDemoUser();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const fetchUsers = async () => {
    const response = await fetch("/api/admin/users", {
      credentials: "include",
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(await readApiErrorMessage(response, "Nem sikerült betölteni a felhasználókat."));
    }

    return (await response.json()) as AdminUser[];
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const payload = await fetchUsers();
        if (!cancelled) {
          setUsers(payload);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Nem sikerült betölteni a felhasználókat.");
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

  const isAdmin = user?.role === "admin";
  const visibleSections = roleSections
    .map((section) => ({
      ...section,
      users: users.filter((currentUser) => currentUser.role === section.role),
    }))
    .filter((section) => section.users.length > 0);

  const handleCloseCreateDialog = () => {
    setCreateDialogOpen(false);
  };

  const handleCreateUser = async (values: UserFormValues) => {
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        const message = await readApiErrorMessage(response, "Nem sikerült létrehozni a felhasználót.");
        if (message.toLowerCase().includes("e-mail cím már használatban van")) {
          return { ok: false as const, emailError: message };
        }
        return { ok: false as const, error: message };
      }

      const createdUser = (await response.json()) as AdminUser;
      setUsers((current) => {
        const next = current.filter((currentUser) => currentUser.id !== createdUser.id);
        next.push(createdUser);
        return next.sort((a, b) => a.full_name.localeCompare(b.full_name, "hu"));
      });
      toast.success("A felhasználó sikeresen létrejött.");

      return { ok: true as const };
    } catch {
      return { ok: false as const, error: "Nem sikerült létrehozni a felhasználót." };
    }
  };

  const accentFabSx = {
    backgroundColor: appColors.accent,
    color: appColors.accentIcon,
    "&:hover": {
      backgroundColor: "#BE9A54",
    },
  } as const;

  return (
    <>
      <Layout>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 800 }}>
              Felhasználók
            </Typography>
          </Box>

          {error ? <Alert severity="error">{error}</Alert> : null}

          {isLoading ? (
            <Box sx={{ py: 8, display: "grid", placeItems: "center" }}>
              <CircularProgress color="secondary" />
            </Box>
          ) : users.length === 0 ? (
            <Alert severity="info">Nincs aktív felhasználó.</Alert>
          ) : (
            <Box
              sx={{
                display: "grid",
                gap: 2,
                gridTemplateColumns: { xs: "1fr", xl: "repeat(2, minmax(0, 1fr))" },
                alignItems: "start",
              }}
            >
              {visibleSections.map((section) => {
                const SectionIcon = roleIcon[section.role] ?? View;

                return (
                  <Card
                    key={section.role}
                    sx={{
                      border: `1px solid ${appColors.border}`,
                      borderRadius: 4,
                      bgcolor: appColors.card,
                      overflow: "hidden",
                      boxShadow: "0 10px 24px rgba(15, 23, 42, 0.06)",
                    }}
                  >
                    <CardContent sx={{ p: 0, "&:last-child": { pb: 0 } }}>
                      <Box
                        sx={{
                          px: 2,
                          py: 1.75,
                          borderBottom: `1px solid ${appColors.border}`,
                          bgcolor: appColors.primary,
                          color: appColors.primaryForeground,
                        }}
                      >
                        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5 }}>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, minWidth: 0 }}>
                            <Box
                              sx={{
                                width: 36,
                                height: 36,
                                borderRadius: "50%",
                                display: "grid",
                                placeItems: "center",
                                bgcolor: "rgba(255, 255, 255, 0.12)",
                                color: appColors.primaryForeground,
                                flexShrink: 0,
                              }}
                            >
                              <SectionIcon size={18} />
                            </Box>
                            <Box sx={{ minWidth: 0 }}>
                              <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                                {section.label}
                              </Typography>
                            </Box>
                          </Box>
                          <Chip
                            label={section.users.length}
                            size="small"
                            sx={{
                              fontWeight: 700,
                              bgcolor: "rgba(255, 255, 255, 0.14)",
                              color: appColors.primaryForeground,
                            }}
                          />
                        </Box>
                      </Box>
                      <List disablePadding>
                        {section.users.map((user, index) => {
                          return (
                            <Box key={user.id}>
                              <ListItem disablePadding
                                sx={{
                                  borderBottom:
                                    index < section.users.length - 1 ? `1px solid ${appColors.border}` : "none",
                                }}
                              >
                                <ListItemButton
                                  onClick={() => navigate(`/admin/users/${user.id}`)}
                                  sx={{
                                    px: 2,
                                    py: 0,
                                    minHeight: 60,
                                  }}
                                >
                                  <ListItemText
                                    primary={
                                      <Typography variant="body1" sx={{ fontWeight: 800, lineHeight: 1.25 }}>
                                        {user.full_name}
                                      </Typography>
                                    }
                                  />
                                </ListItemButton>
                              </ListItem>
                            </Box>
                          );
                        })}
                      </List>
                    </CardContent>
                  </Card>
                );
              })}
            </Box>
          )}
        </Box>

        <UserFormDialog
          open={createDialogOpen}
          onClose={handleCloseCreateDialog}
          title="Felhasználó hozzáadása"
          description="Adja meg az új felhasználó alapadatait és válassza ki a megfelelő szerepkört."
          submitLabel="Létrehozás"
          initialValues={{
            full_name: "",
            email: "",
            phone_number: null,
            role: "technician",
          }}
          onSubmit={handleCreateUser}
        />
      </Layout>

      {isAdmin ? (
        <Fab
          aria-label="Felhasználó hozzáadása"
          onClick={() => setCreateDialogOpen(true)}
          sx={{
            ...accentFabSx,
            position: "fixed",
            right: 32,
            bottom: "calc(32px + env(safe-area-inset-bottom))",
            zIndex: 1200,
          }}
        >
          <Plus size={20} />
        </Fab>
      ) : null}
    </>
  );
}
