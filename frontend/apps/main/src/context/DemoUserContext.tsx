import { ReactNode } from "react";
import { AuthProvider, useAuth } from "@noma/shared";

export type DemoUserRole = "admin" | "technician" | "partner";

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
