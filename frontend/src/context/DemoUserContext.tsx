import { createContext, ReactNode, useContext, useMemo, useState } from "react";

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
};

const DemoUserContext = createContext<DemoUserContextType | undefined>(undefined);

const demoUsers: DemoUser[] = [
  { id: "u-tech", name: "Technikus Tamás", role: "technician" },
  { id: "u-partner", name: "Partner Péter", role: "partner" },
];

export function DemoUserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<DemoUser | null>(null);

  const value = useMemo(
    () => ({
      user,
      users: demoUsers,
      selectUser: (selected: DemoUser) => setUser(selected),
      clearUser: () => setUser(null),
    }),
    [user],
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
