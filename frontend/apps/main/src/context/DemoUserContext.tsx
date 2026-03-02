import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";

export type DemoUserRole = "admin" | "technician" | "partner";

export type DemoUser = {
  id: string;
  name: string;
  role: DemoUserRole;
};

type DemoUserContextType = {
  user: DemoUser | null;
  users: DemoUser[];
  selectUser: (user: DemoUser) => void;
  clearUser: () => void;
  isHydrated: boolean;
};

const DemoUserContext = createContext<DemoUserContextType | undefined>(undefined);

const demoUsers: DemoUser[] = [
  { id: "u-tech", name: "Technikus Tamás", role: "technician" },
  { id: "u-partner", name: "Partner Péter", role: "partner" },
];

const demoUserStorageKey = "noma:demo-user";
const findDemoUserById = (id: string) => demoUsers.find((demoUser) => demoUser.id === id) ?? null;

export function DemoUserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<DemoUser | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }
    const stored = window.localStorage.getItem(demoUserStorageKey);
    if (!stored) {
      return null;
    }
    try {
      const parsed = JSON.parse(stored) as DemoUser | string;
      if (typeof parsed === "string") {
        return findDemoUserById(parsed);
      }
      if (parsed && typeof parsed === "object" && "id" in parsed) {
        return (parsed as DemoUser) ?? null;
      }
      return null;
    } catch {
      return findDemoUserById(stored);
    }
  });
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (user) {
      window.localStorage.setItem(demoUserStorageKey, JSON.stringify(user));
    } else {
      window.localStorage.removeItem(demoUserStorageKey);
    }
  }, [user]);

  useEffect(() => {
    if (typeof window === "undefined") {
      setIsHydrated(true);
      return;
    }
    if (!user) {
      const stored = window.localStorage.getItem(demoUserStorageKey);
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as DemoUser | string;
          if (typeof parsed === "string") {
            setUser(findDemoUserById(parsed));
          } else if (parsed && typeof parsed === "object" && "id" in parsed) {
            setUser(parsed as DemoUser);
          } else {
            setUser(findDemoUserById(stored));
          }
        } catch {
          setUser(findDemoUserById(stored));
        }
      }
    }
    setIsHydrated(true);
  }, [user]);

  const value = useMemo(
    () => ({
      user,
      users: demoUsers,
      selectUser: (selected: DemoUser) => setUser(selected),
      clearUser: () => setUser(null),
      isHydrated,
    }),
    [user, isHydrated],
  );

  return <DemoUserContext.Provider value={value}>{children}</DemoUserContext.Provider>;
}

export function useDemoUser() {
  const context = useContext(DemoUserContext);
  if (!context) {
    throw new Error("useDemoUser must be used within a DemoUserProvider");
  }
  return context;
}
