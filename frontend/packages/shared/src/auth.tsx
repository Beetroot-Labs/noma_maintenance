import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";

export type AuthUserRole =
  | "admin"
  | "lead_technician"
  | "technician"
  | "viewer"
  | "partner";

export type AuthUser = {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: AuthUserRole;
};

type AuthContextValue = {
  user: AuthUser | null;
  clearUser: () => Promise<void>;
  loginWithGoogle: (credential: string) => Promise<void>;
  isHydrated: boolean;
  isAuthenticating: boolean;
};

type AuthProviderProps = {
  children: ReactNode;
  defaultRole?: AuthUserRole;
};

type AuthResponse = {
  user: {
    id: string;
    tenant_id: string;
    full_name: string;
    email: string;
    role?: string;
  };
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const AUTH_USER_STORAGE_KEY = "noma:auth-user";

const readErrorMessage = async (response: Response) => {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // Ignore JSON parsing errors and fall back to a generic message.
  }
  return "Sikertelen kérés.";
};

const normalizeRole = (
  role: string | undefined,
  defaultRole: AuthUserRole,
): AuthUserRole => {
  if (!role) {
    return defaultRole;
  }
  const normalized = role.toLowerCase();
  if (normalized === "admin") return "admin";
  if (normalized === "lead_technician") return "lead_technician";
  if (normalized === "technician") return "technician";
  if (normalized === "viewer") return "viewer";
  if (normalized === "partner") return "partner";
  return defaultRole;
};

const toAuthUser = (payload: AuthResponse["user"], defaultRole: AuthUserRole): AuthUser => ({
  id: payload.id,
  tenantId: payload.tenant_id,
  name: payload.full_name,
  email: payload.email,
  role: normalizeRole(payload.role, defaultRole),
});

const loadStoredUser = (): AuthUser | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(AUTH_USER_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
};

const storeUser = (user: AuthUser | null) => {
  if (typeof window === "undefined") {
    return;
  }

  if (!user) {
    window.localStorage.removeItem(AUTH_USER_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user));
};

export function AuthProvider({
  children,
  defaultRole = "technician",
}: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(() => loadStoredUser());
  const [isHydrated, setIsHydrated] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  useEffect(() => {
    let ignore = false;

    const loadCurrentUser = async () => {
      const storedUser = loadStoredUser();
      if (!ignore && storedUser) {
        setUser(storedUser);
        setIsHydrated(true);
      }

      try {
        const response = await fetch("/api/auth/me", {
          credentials: "include",
        });

        if (!response.ok) {
          if (!ignore) {
            setUser(null);
            storeUser(null);
          }
          return;
        }

        const payload = (await response.json()) as AuthResponse;
        if (!ignore) {
          const nextUser = toAuthUser(payload.user, defaultRole);
          setUser(nextUser);
          storeUser(nextUser);
        }
      } catch {
        // Keep the last known authenticated user while offline.
      } finally {
        if (!ignore) {
          setIsHydrated(true);
        }
      }
    };

    loadCurrentUser();

    return () => {
      ignore = true;
    };
  }, [defaultRole]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      clearUser: async () => {
        try {
          await fetch("/api/auth/logout", {
            method: "POST",
            credentials: "include",
          });
        } finally {
          setUser(null);
          storeUser(null);
        }
      },
      loginWithGoogle: async (credential: string) => {
        setIsAuthenticating(true);
        try {
          const response = await fetch("/api/auth/google", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify({ credential }),
          });

          if (!response.ok) {
            throw new Error(await readErrorMessage(response));
          }

          const payload = (await response.json()) as AuthResponse;
          const nextUser = toAuthUser(payload.user, defaultRole);
          setUser(nextUser);
          storeUser(nextUser);
        } finally {
          setIsAuthenticating(false);
        }
      },
      isHydrated,
      isAuthenticating,
    }),
    [defaultRole, isHydrated, isAuthenticating, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
