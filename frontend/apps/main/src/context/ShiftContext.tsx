import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useDemoUser } from "@/context/DemoUserContext";

export type CurrentShiftSummary = {
  id: string;
  status:
    | "INVITING"
    | "READY_TO_START"
    | "IN_PROGRESS"
    | "CLOSE_REQUESTED";
  building_id: string;
  building_name: string;
  lead_user_name: string;
  lead_user_phone: string | null;
  my_participant_status:
    | "INVITED"
    | "ACCEPTED"
    | "CACHE_READY"
    | "DECLINED"
    | "CLOSE_CONFIRMED";
};

type ShiftContextValue = {
  currentShift: CurrentShiftSummary | null;
  isLoading: boolean;
  refreshCurrentShift: () => Promise<CurrentShiftSummary | null>;
};

const ShiftContext = createContext<ShiftContextValue | undefined>(undefined);
const shiftStorageKey = (userId: string) => `noma:current-shift:${userId}`;

const loadStoredShift = (userId: string): CurrentShiftSummary | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(shiftStorageKey(userId));
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as CurrentShiftSummary;
  } catch {
    return null;
  }
};

const storeShift = (userId: string, shift: CurrentShiftSummary | null) => {
  if (typeof window === "undefined") {
    return;
  }

  if (!shift) {
    window.localStorage.removeItem(shiftStorageKey(userId));
    return;
  }

  window.localStorage.setItem(shiftStorageKey(userId), JSON.stringify(shift));
};

export function ShiftProvider({ children }: { children: ReactNode }) {
  const { user, isHydrated } = useDemoUser();
  const [currentShift, setCurrentShift] = useState<CurrentShiftSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshCurrentShift = useCallback(async (): Promise<CurrentShiftSummary | null> => {
    if (!user) {
      setCurrentShift(null);
      setIsLoading(false);
      return null;
    }

    const response = await fetch("/api/shifts/current", {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error("Nem sikerült betölteni az aktuális műszakot.");
    }

    const payload = (await response.json()) as {
      shift: CurrentShiftSummary | null;
    };
    setCurrentShift(payload.shift);
    storeShift(user.id, payload.shift);
    return payload.shift;
  }, [user]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    if (!user) {
      setCurrentShift(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      const storedShift = loadStoredShift(user.id);
      if (!cancelled && storedShift) {
        setCurrentShift(storedShift);
        setIsLoading(false);
      }

      setIsLoading(true);
      try {
        const shift = await refreshCurrentShift();
        if (cancelled) {
          return;
        }
        setCurrentShift(shift);
      } catch {
        // Keep the last known shift while offline.
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();

    const intervalId = window.setInterval(() => {
      void refreshCurrentShift().catch(() => {
        // Keep the last known shift while offline.
      });
    }, 15_000);

    const handleFocus = () => {
      void refreshCurrentShift().catch(() => {
        // Keep the last known shift while offline.
      });
    };

    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
    };
  }, [isHydrated, refreshCurrentShift, user]);

  const value = useMemo<ShiftContextValue>(
    () => ({
      currentShift,
      isLoading,
      refreshCurrentShift,
    }),
    [currentShift, isLoading, refreshCurrentShift],
  );

  return <ShiftContext.Provider value={value}>{children}</ShiftContext.Provider>;
}

export function useShift() {
  const context = useContext(ShiftContext);
  if (!context) {
    throw new Error("useShift must be used within a ShiftProvider");
  }
  return context;
}
