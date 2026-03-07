export const productNames = {
  main: "Noma Maintenance",
  labeling: "Noma Karbantartás Címkéző",
} as const;

export { AuthProvider, useAuth } from "./auth";
export type { AuthUser, AuthUserRole } from "./auth";
export { validateNomaBarcode } from "./barcodes";
export type { NomaBarcodeValidationResult } from "./barcodes";
export { useCode128Scanner } from "./code128Scanner";
export type { Code128DetectionResult, ScannerProfileId } from "./code128Scanner";
export { deviceKindLabels, getDeviceKindLabel } from "./deviceKinds";
export type { DeviceKind } from "./deviceKinds";
export { GoogleSignInButton } from "./googleIdentity";
export { GoogleLoginScreen } from "./googleLoginScreen";
export {
  cacheBuildingSnapshot,
  fetchBuildingCachePayload,
  getCachedBuildingSnapshot,
} from "./buildingCache";
export type {
  SharedBuildingCachePayload,
  SharedCachedBuilding,
  SharedCachedDevice,
  SharedCachedLocation,
} from "./buildingCache";
export {
  createSyncRunner,
  isRetryableHttpStatus,
  summarizeOutboxItems,
  useOfflineSyncSummary,
} from "./offlineSync";
export type { OfflineOutboxItem, OfflineSyncStatus, OfflineSyncStatusSummary } from "./offlineSync";
export { appColors, theme } from "./theme";
