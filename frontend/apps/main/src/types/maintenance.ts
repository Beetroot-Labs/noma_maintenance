export interface MaintenancePhoto {
  id: string;
  url: string;
  description: string;
  timestamp: Date;
}

export type FollowupServiceReason =
  | "MAIN_COMPONENT_REPLACEMENT"
  | "CLEANING"
  | "DAMAGED"
  | "OTHER"
  | "FAULT_DIAGNOSIS_REQUIRED"
  | "PERFORMANCE_DEGRADATION"
  | "ABNORMAL_ODOR"
  | "REFRIGERANT_LOW_OR_LEAK";

export const followupServiceReasonLabels: Record<FollowupServiceReason, string> = {
  MAIN_COMPONENT_REPLACEMENT: "Fődarab csere",
  CLEANING: "Mosás",
  DAMAGED: "Rongált",
  OTHER: "Egyéb",
  FAULT_DIAGNOSIS_REQUIRED: "Hibakeresés szükséges",
  PERFORMANCE_DEGRADATION: "Teljesítmény csökkenés",
  ABNORMAL_ODOR: "Rendellenes szag",
  REFRIGERANT_LOW_OR_LEAK: "Hűtőközeg hiány/szivárgás",
};

export const followupServiceReasonOrder: FollowupServiceReason[] = [
  "MAIN_COMPONENT_REPLACEMENT",
  "CLEANING",
  "DAMAGED",
  "OTHER",
  "FAULT_DIAGNOSIS_REQUIRED",
  "PERFORMANCE_DEGRADATION",
  "ABNORMAL_ODOR",
  "REFRIGERANT_LOW_OR_LEAK",
];

export interface MaintenanceWork {
  id: string;
  shiftId: string;
  deviceId: string;
  hvacId: string;
  hvacModel: string;
  hvacKind: string;
  hvacAddress: string;
  hvacLocation: string;
  executorId: string;
  status: "in-progress" | "completed";
  isMalfunctioning: boolean;
  followupServiceRequired: boolean;
  followupServiceReasons: FollowupServiceReason[];
  followupServiceReasonOther: string;
  notes: string;
  photos: MaintenancePhoto[];
  startTime: Date;
  endTime?: Date;
  lastEdited?: Date;
}

export interface MaintenanceWorkSyncState {
  status: "synced" | "retriable" | "error";
  lastError: string | null;
}

export interface ShiftManager {
  name: string;
  phone: string;
}
