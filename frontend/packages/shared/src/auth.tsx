import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";

export type AuthUserRole = "admin" | "technician" | "partner";

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
  };
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

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

const toAuthUser = (payload: AuthResponse["user"], defaultRole: AuthUserRole): AuthUser => ({
  id: payload.id,
  tenantId: payload.tenant_id,
  name: payload.full_name,
  email: payload.email,
  role: defaultRole,
});

export function AuthProvider({
  children,
  defaultRole = "technician",
}: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  useEffect(() => {
    let ignore = false;

    const loadCurrentUser = async () => {
      try {
        const response = await fetch("/api/auth/me", {
          credentials: "include",
        });

        if (!response.ok) {
          if (!ignore) {
            setUser(null);
          }
          return;
        }

        const payload = (await response.json()) as AuthResponse;
        if (!ignore) {
          setUser(toAuthUser(payload.user, defaultRole));
        }
      } catch {
        if (!ignore) {
          setUser(null);
        }
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
          setUser(toAuthUser(payload.user, defaultRole));
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
