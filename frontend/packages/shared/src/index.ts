export const productNames = {
  main: "Noma Maintenance",
  labeling: "Noma Karbantartás Címkéző",
} as const;

export { AuthProvider, useAuth } from "./auth";
export type { AuthUser, AuthUserRole } from "./auth";
export { GoogleSignInButton } from "./googleIdentity";
