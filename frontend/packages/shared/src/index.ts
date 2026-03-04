export const productNames = {
  main: "Noma Maintenance",
  labeling: "Noma Karbantartás Címkéző",
} as const;

export { AuthProvider, useAuth } from "./auth";
export type { AuthUser, AuthUserRole } from "./auth";
export { validateNomaBarcode } from "./barcodes";
export type { NomaBarcodeValidationResult } from "./barcodes";
export { deviceKindLabels, getDeviceKindLabel } from "./deviceKinds";
export type { DeviceKind } from "./deviceKinds";
export { GoogleSignInButton } from "./googleIdentity";
export { appColors, theme } from "./theme";
