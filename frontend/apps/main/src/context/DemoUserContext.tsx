import { ReactNode } from "react";
import { AuthProvider, type AuthUserRole, useAuth } from "@noma/shared";

export type DemoUserRole = AuthUserRole;

export type DemoUser = {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: DemoUserRole;
};

export function DemoUserProvider({ children }: { children: ReactNode }) {
  return <AuthProvider defaultRole="technician">{children}</AuthProvider>;
}

export function useDemoUser() {
  return useAuth();
}
