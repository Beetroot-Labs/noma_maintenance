import type { CurrentShiftSummary } from "@/context/ShiftContext";

export const hasActiveShiftAccess = (currentShift: CurrentShiftSummary | null) =>
  Boolean(
    currentShift &&
      ["READY_TO_START", "IN_PROGRESS", "CLOSE_REQUESTED"].includes(currentShift.status) &&
      ["CACHE_READY", "CLOSE_CONFIRMED"].includes(currentShift.my_participant_status),
  );
