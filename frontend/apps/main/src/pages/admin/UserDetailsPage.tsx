import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { ArrowLeft, HardHat, Mail, Phone, Pencil, Users, View, Wrench } from "lucide-react";
import { Layout } from "@/components/Layout";
import { useDemoUser } from "@/context/DemoUserContext";
import { toast } from "@/lib/toast";
import { appColors } from "@/theme";
import { UserFormDialog, type UserFormValues } from "./UserFormDialog";

type AdminUserDetailsPayload = {
  id: string;
  full_name: string;
  email: string;
  phone_number: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
  email_verified_at: string | null;
  last_login_at: string | null;
  shifts_led_count: number;
  shifts_joined_count: number;
  maintenances_count: number;
};

const roleIcon: Record<string, typeof HardHat> = {
  ADMIN: Users,
  LEAD_TECHNICIAN: HardHat,
  TECHNICIAN: Wrench,
  VIEWER: View,
};

const roleLabel: Record<string, string> = {
  ADMIN: "Adminisztrátor",
  LEAD_TECHNICIAN: "Vezető technikus",
  TECHNICIAN: "Technikus",
  VIEWER: "Megtekintő",
};

const readApiErrorMessage = async (response: Response, fallback: string) => {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // Ignore malformed payloads.
  }
  return fallback;
};

export default function UserDetailsPage() {
  const navigate = useNavigate();
  const { user } = useDemoUser();
  const { userId } = useParams<{ userId: string }>();
  const [payload, setPayload] = useState<AdminUserDetailsPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!userId) {
        setPayload(null);
        setError("A felhasználó azonosítója hiányzik.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/admin/users/${userId}`, {
          credentials: "include",
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(await readApiErrorMessage(response, "Nem sikerült betölteni a felhasználó részleteit."));
        }

        const nextPayload = (await response.json()) as AdminUserDetailsPayload;
        if (!cancelled) {
          setPayload(nextPayload);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Nem sikerült betölteni a felhasználó részleteit.");
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
  }, [userId]);

  if (isLoading) {
    return (
      <Layout>
        <Box sx={{ py: 8, display: "grid", placeItems: "center" }}>
          <CircularProgress color="secondary" />
        </Box>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <IconButton onClick={() => navigate("/admin/users")} aria-label="Vissza">
              <ArrowLeft size={18} />
            </IconButton>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>
              Felhasználó részletei
            </Typography>
          </Box>
          <Alert severity="error">{error}</Alert>
        </Box>
      </Layout>
    );
  }

  if (!payload) {
    return (
      <Layout>
        <Alert severity="info">A felhasználó nem található.</Alert>
      </Layout>
    );
  }

  const isAdmin = user?.role === "admin";
  const RoleIcon = roleIcon[payload.role] ?? View;

  const handleUpdateUser = async (values: UserFormValues) => {
    try {
      const response = await fetch(`/api/admin/users/${payload.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        const message = await readApiErrorMessage(response, "Nem sikerült frissíteni a felhasználót.");
        if (message.toLowerCase().includes("e-mail cím már használatban van")) {
          return { ok: false as const, emailError: message };
        }
        return { ok: false as const, error: message };
      }

      const nextPayload = (await response.json()) as AdminUserDetailsPayload;
      setPayload(nextPayload);
      toast.success("A felhasználó adatai sikeresen frissültek.");
      return { ok: true as const };
    } catch {
      return { ok: false as const, error: "Nem sikerült frissíteni a felhasználót." };
    }
  };

  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <IconButton onClick={() => navigate("/admin/users")} aria-label="Vissza">
              <ArrowLeft size={18} />
            </IconButton>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>
              Felhasználó részletei
            </Typography>
          </Box>
          {isAdmin ? (
            <Tooltip title="Felhasználó szerkesztése">
              <IconButton onClick={() => setEditDialogOpen(true)} aria-label="Felhasználó szerkesztése">
                <Pencil size={18} />
              </IconButton>
            </Tooltip>
          ) : null}
        </Box>

        <Card
          sx={{
            border: `1px solid ${appColors.border}`,
            borderRadius: 4,
            boxShadow: "0 10px 24px rgba(15, 23, 42, 0.06)",
          }}
        >
          <CardContent sx={{ p: { xs: 2.25, md: 3 } }}>
            <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, minWidth: 0 }}>
                <Box
                  sx={{
                    width: 52,
                    height: 52,
                    borderRadius: "50%",
                    display: "grid",
                    placeItems: "center",
                    bgcolor: appColors.primary,
                    color: appColors.primaryForeground,
                    flexShrink: 0,
                  }}
                >
                  <RoleIcon size={24} />
                </Box>
                <Stack spacing={0.75} sx={{ minWidth: 0 }}>
                  <Typography variant="h5" sx={{ fontWeight: 800, lineHeight: 1.15 }}>
                    {payload.full_name}
                  </Typography>
                  <Typography variant="body1" color="text.secondary" sx={{ wordBreak: "break-word" }}>
                    {payload.email}
                  </Typography>
                  <Typography variant="body1" color="text.secondary">
                    {payload.phone_number?.trim() || "-"}
                  </Typography>
                </Stack>
              </Box>
              <Box sx={{ display: "flex", flexDirection: "column", alignItems: { xs: "flex-start", sm: "flex-end" }, gap: 1, flexWrap: "wrap" }}>
                <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                  <Chip label={roleLabel[payload.role] ?? payload.role} sx={{ fontWeight: 700 }} />
                  <Chip
                    label={payload.is_active ? "Aktív" : "Inaktív"}
                    sx={{
                      fontWeight: 700,
                      bgcolor: payload.is_active ? "rgba(26, 127, 55, 0.14)" : "rgba(190, 24, 93, 0.12)",
                      color: payload.is_active ? appColors.foreground : appColors.destructive,
                    }}
                  />
                </Box>
                <Box sx={{ display: "flex", gap: 0.75 }}>
                  <Tooltip title="E-mail küldése">
                    <span>
                      <IconButton
                        component="a"
                        href={`mailto:${payload.email}`}
                        aria-label="E-mail küldése"
                        sx={{
                          color: appColors.primary,
                        }}
                      >
                        <Mail size={18} />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Hívás indítása">
                    <span>
                      <IconButton
                        component="a"
                        href={payload.phone_number?.trim() ? `tel:${payload.phone_number.trim()}` : undefined}
                        aria-label="Hívás indítása"
                        disabled={!payload.phone_number?.trim()}
                        sx={{
                          color: appColors.primary,
                        }}
                      >
                        <Phone size={18} />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
              </Box>
            </Box>
          </CardContent>
        </Card>

        <UserFormDialog
          open={editDialogOpen}
          onClose={() => setEditDialogOpen(false)}
          title="Felhasználó szerkesztése"
          description="Módosítsa a felhasználó adatait. Az e-mail cím itt nem változtatható meg."
          submitLabel="Mentés"
          emailDisabled
          initialValues={{
            full_name: payload.full_name,
            email: payload.email,
            phone_number: payload.phone_number,
            role: payload.role.toLowerCase(),
          }}
          onSubmit={handleUpdateUser}
        />
      </Box>
    </Layout>
  );
}
