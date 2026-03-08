import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useDemoUser } from "@/context/DemoUserContext";

export type CurrentShiftSummary = {
  id: string;
  status: "INVITING" | "READY_TO_START" | "IN_PROGRESS";
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
      setIsLoading(true);
      try {
        const shift = await refreshCurrentShift();
        if (cancelled) {
          return;
        }
        setCurrentShift(shift);
      } catch {
        if (!cancelled) {
          setCurrentShift(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();

    const intervalId = window.setInterval(() => {
      void refreshCurrentShift().catch(() => {
        if (!cancelled) {
          setCurrentShift(null);
        }
      });
    }, 15_000);

    const handleFocus = () => {
      void refreshCurrentShift().catch(() => {
        if (!cancelled) {
          setCurrentShift(null);
        }
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
