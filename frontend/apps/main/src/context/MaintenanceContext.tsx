import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { MaintenancePhoto, MaintenanceWork, ShiftManager } from "@/types/maintenance";
import { useDemoUser } from "@/context/DemoUserContext";
import { getCachedBuildingSnapshot } from "@noma/shared";
import {
  clearMaintenanceState,
  loadMaintenanceState,
  saveMaintenanceState,
} from "@/lib/maintenanceStore";
import { clearPhotos, getPhotosByIds, purgeDemoPhotos, savePhoto } from "@/lib/photoStore";

interface MaintenanceContextType {
  currentWork: MaintenanceWork | null;
  todaysWorks: MaintenanceWork[];
  pastWorks: MaintenanceWork[];
  workdayClosed: boolean;
  shiftManager: ShiftManager;
  startMaintenance: (hvacId: string) => string | null;
  updateNotes: (workId: string, notes: string) => void;
  addPhoto: (workId: string, photo: MaintenancePhoto) => void;
  toggleMalfunction: (workId: string) => void;
  completeMaintenance: (workId: string) => void;
  abortMaintenance: (workId: string) => void;
  markEdited: (workId: string) => void;
  closeWorkday: () => void;
  resetMaintenance: () => Promise<boolean>;
}

const MaintenanceContext = createContext<MaintenanceContextType | undefined>(undefined);
const legacyMaintenanceStorageKey = "noma:maintenance-state";
const maxPersistedPastWorks = 50;

type StoredMaintenancePhoto = {
  id: string;
  description: string;
  timestamp: string;
};
type StoredMaintenanceWork = Omit<
  MaintenanceWork,
  "startTime" | "endTime" | "lastEdited" | "photos"
> & {
  startTime: string;
  endTime?: string;
  lastEdited?: string;
  photos: StoredMaintenancePhoto[];
};

type StoredMaintenanceState = {
  currentWork: StoredMaintenanceWork | null;
  todaysWorks: StoredMaintenanceWork[];
  pastWorks: StoredMaintenanceWork[];
  workdayClosed: boolean;
};

type DeviceCacheLookupEntry = {
  model: string;
  kind: string;
  address: string;
  location: string;
};

const serializeWork = (work: MaintenanceWork): StoredMaintenanceWork => ({
  ...work,
  startTime: work.startTime.toISOString(),
  endTime: work.endTime ? work.endTime.toISOString() : undefined,
  lastEdited: work.lastEdited ? work.lastEdited.toISOString() : undefined,
  photos: work.photos.map((photo) => ({
    id: photo.id,
    description: photo.description,
    timestamp: photo.timestamp.toISOString(),
  })),
});

const deserializeWork = (work: StoredMaintenanceWork): MaintenanceWork => ({
  ...work,
  startTime: new Date(work.startTime),
  endTime: work.endTime ? new Date(work.endTime) : undefined,
  lastEdited: work.lastEdited ? new Date(work.lastEdited) : undefined,
  photos: (work.photos ?? []).map((photo) => {
    const legacy = photo as StoredMaintenancePhoto & { url?: string };
    return {
      id: legacy.id,
      url: legacy.url ?? "",
      description: legacy.description ?? "",
      timestamp: new Date(legacy.timestamp),
    };
  }),
});

export function MaintenanceProvider({ children }: { children: ReactNode }) {
  const { user } = useDemoUser();
  const [currentWork, setCurrentWork] = useState<MaintenanceWork | null>(null);
  const [todaysWorks, setTodaysWorks] = useState<MaintenanceWork[]>([]);
  const [pastWorks, setPastWorks] = useState<MaintenanceWork[]>([]);
  const [workdayClosed, setWorkdayClosed] = useState(false);
  const [isMaintenanceStateLoaded, setIsMaintenanceStateLoaded] = useState(false);
  const [deviceLookup, setDeviceLookup] = useState<Map<string, DeviceCacheLookupEntry>>(
    new Map(),
  );

  const shiftManager: ShiftManager = {
    name: "Ivanics Károly",
    phone: "+36301234567",
  };

  useEffect(() => {
    let cancelled = false;

    if (typeof window !== "undefined") {
      window.localStorage.removeItem(legacyMaintenanceStorageKey);
    }

    const loadPersistedMaintenanceState = async () => {
      if (!user?.tenantId || !user.id) {
        if (!cancelled) {
          setCurrentWork(null);
          setTodaysWorks([]);
          setPastWorks([]);
          setWorkdayClosed(false);
          setIsMaintenanceStateLoaded(true);
        }
        return;
      }

      try {
        const persisted = (await loadMaintenanceState(
          user.tenantId,
          user.id,
        )) as StoredMaintenanceState | null;
        if (cancelled) {
          return;
        }

        setCurrentWork(persisted?.currentWork ? deserializeWork(persisted.currentWork) : null);
        setTodaysWorks((persisted?.todaysWorks ?? []).map(deserializeWork));
        setPastWorks((persisted?.pastWorks ?? []).map(deserializeWork));
        setWorkdayClosed(persisted?.workdayClosed ?? false);
      } catch (error) {
        if (!cancelled) {
          console.warn("Nem sikerült betölteni a karbantartási állapotot.", error);
          setCurrentWork(null);
          setTodaysWorks([]);
          setPastWorks([]);
          setWorkdayClosed(false);
        }
      } finally {
        if (!cancelled) {
          setIsMaintenanceStateLoaded(true);
        }
      }
    };

    setIsMaintenanceStateLoaded(false);
    void loadPersistedMaintenanceState();

    return () => {
      cancelled = true;
    };
  }, [user?.tenantId, user?.id]);

  useEffect(() => {
    purgeDemoPhotos().catch((error) => {
      console.warn("Nem sikerült törölni a demó fotókat.", error);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    const composeLocation = (
      floor: string | null,
      wing: string | null,
      room: string | null,
      description: string | null,
    ) => {
      const primary = [floor, wing, room].map((part) => part?.trim()).filter(Boolean).join(", ");
      const secondary = description?.trim();
      if (primary && secondary) {
        return `${primary} (${secondary})`;
      }
      if (primary) {
        return primary;
      }
      if (secondary) {
        return secondary;
      }
      return "Ismeretlen helyszín";
    };

    const loadDeviceLookup = async () => {
      if (!user?.tenantId) {
        if (!cancelled) {
          setDeviceLookup(new Map());
        }
        return;
      }

      try {
        const currentShiftResponse = await fetch("/api/shifts/current", {
          credentials: "include",
          cache: "no-store",
        });
        if (!currentShiftResponse.ok) {
          if (!cancelled) {
            setDeviceLookup(new Map());
          }
          return;
        }

        const currentShiftPayload = (await currentShiftResponse.json()) as {
          shift: { id: string } | null;
        };
        const shiftId = currentShiftPayload.shift?.id;
        if (!shiftId) {
          if (!cancelled) {
            setDeviceLookup(new Map());
          }
          return;
        }

        const waitingRoomResponse = await fetch(`/api/shifts/${shiftId}/waiting-room`, {
          credentials: "include",
          cache: "no-store",
        });
        if (!waitingRoomResponse.ok) {
          if (!cancelled) {
            setDeviceLookup(new Map());
          }
          return;
        }

        const waitingRoomPayload = (await waitingRoomResponse.json()) as { building_id: string };
        const snapshot = await getCachedBuildingSnapshot(user.tenantId, waitingRoomPayload.building_id);
        if (!snapshot) {
          if (!cancelled) {
            setDeviceLookup(new Map());
          }
          return;
        }

        const locationById = new Map(
          snapshot.locations.map((location) => [
            location.id,
            composeLocation(
              location.floor,
              location.wing,
              location.room,
              location.location_description,
            ),
          ]),
        );

        const nextLookup = new Map<string, DeviceCacheLookupEntry>();
        for (const device of snapshot.devices) {
          const code = device.code?.trim();
          if (!code) {
            continue;
          }
          nextLookup.set(code, {
            model: device.model?.trim() || "Ismeretlen modell",
            kind: device.kind?.trim() || "UNKNOWN",
            address: snapshot.building.address?.trim() || "Ismeretlen cím",
            location:
              (device.location_id ? locationById.get(device.location_id) : null) ||
              "Ismeretlen helyszín",
          });
        }

        if (!cancelled) {
          setDeviceLookup(nextLookup);
        }
      } catch {
        if (!cancelled) {
          setDeviceLookup(new Map());
        }
      }
    };

    void loadDeviceLookup();
    return () => {
      cancelled = true;
    };
  }, [user?.tenantId]);

  useEffect(() => {
    let isActive = true;
    const hydratePhotos = async () => {
      const ids = new Set<string>();
      const works = [currentWork, ...todaysWorks, ...pastWorks].filter(
        (work): work is MaintenanceWork => Boolean(work),
      );
      for (const work of works) {
        for (const photo of work.photos) {
          if (!photo.url) {
            ids.add(photo.id);
          }
        }
      }
      if (ids.size === 0) return;
      try {
        const photos = await getPhotosByIds(Array.from(ids));
        if (!isActive || photos.length === 0) return;
        const photoMap = new Map(photos.map((photo) => [photo.id, photo]));
        const applyPhotos = (work: MaintenanceWork) => ({
          ...work,
          photos: work.photos.map((photo) => {
            const stored = photoMap.get(photo.id);
            return stored ? { ...photo, url: stored.url } : photo;
          }),
        });
        if (currentWork) {
          setCurrentWork(applyPhotos(currentWork));
        }
        setTodaysWorks((prev) => prev.map(applyPhotos));
        setPastWorks((prev) => prev.map(applyPhotos));
      } catch (error) {
        console.warn("Nem sikerült betölteni a tárolt fotókat.", error);
      }
    };

    hydratePhotos();

    return () => {
      isActive = false;
    };
  }, [currentWork, pastWorks, todaysWorks]);

  useEffect(() => {
    if (!user?.tenantId || !user.id || !isMaintenanceStateLoaded) {
      return;
    }
    const works = [currentWork, ...todaysWorks, ...pastWorks].filter(
      (work): work is MaintenanceWork => Boolean(work),
    );
    for (const work of works) {
      for (const photo of work.photos) {
        if (!photo.url) continue;
        savePhoto(photo).catch((error) => {
          console.warn("Nem sikerült a fotót tárolni.", error);
        });
      }
    }
    const persistedPastWorks = pastWorks
      .sort((a, b) => {
        const aTime = a.endTime?.getTime() ?? a.startTime.getTime();
        const bTime = b.endTime?.getTime() ?? b.startTime.getTime();
        return bTime - aTime;
      })
      .slice(0, maxPersistedPastWorks);
    const payload: StoredMaintenanceState = {
      currentWork: currentWork ? serializeWork(currentWork) : null,
      todaysWorks: todaysWorks.map(serializeWork),
      pastWorks: persistedPastWorks.map(serializeWork),
      workdayClosed,
    };
    saveMaintenanceState(user.tenantId, user.id, payload).catch((error) => {
      console.warn("Nem sikerült menteni a karbantartási adatokat.", error);
    });
  }, [
    currentWork,
    pastWorks,
    todaysWorks,
    workdayClosed,
    user?.tenantId,
    user?.id,
    isMaintenanceStateLoaded,
  ]);

  const startMaintenance = (hvacId: string): string | null => {
    setWorkdayClosed(false);
    const hvacInfo = deviceLookup.get(hvacId);
    if (!hvacInfo) {
      return null;
    }

    const newWork: MaintenanceWork = {
      id: `MW-${Date.now()}`,
      hvacId,
      hvacModel: hvacInfo.model,
      hvacKind: hvacInfo.kind,
      hvacAddress: hvacInfo.address,
      hvacLocation: hvacInfo.location,
      executorId: user?.id || "unknown",
      status: "in-progress",
      isMalfunctioning: false,
      notes: "",
      photos: [],
      startTime: new Date(),
    };

    setCurrentWork(newWork);
    setTodaysWorks((prev) => [...prev, newWork]);

    return newWork.id;
  };

  const updateNotes = (workId: string, notes: string) => {
    if (currentWork?.id === workId) {
      setCurrentWork({ ...currentWork, notes });
    }
    setTodaysWorks((prev) =>
      prev.map((work) => (work.id === workId ? { ...work, notes } : work)),
    );
    setPastWorks((prev) =>
      prev.map((work) =>
        work.id === workId && work.status === "completed" ? { ...work, notes } : work,
      ),
    );
  };

  const addPhoto = (workId: string, photo: MaintenancePhoto) => {
    savePhoto(photo).catch((error) => {
      console.warn("Nem sikerült a fotót tárolni.", error);
    });
    if (currentWork?.id === workId) {
      setCurrentWork({
        ...currentWork,
        photos: [...currentWork.photos, photo],
      });
    }
    setTodaysWorks((prev) =>
      prev.map((work) =>
        work.id === workId ? { ...work, photos: [...work.photos, photo] } : work,
      ),
    );
    setPastWorks((prev) =>
      prev.map((work) =>
        work.id === workId && work.status === "completed"
          ? { ...work, photos: [...work.photos, photo] }
          : work,
      ),
    );
  };

  const toggleMalfunction = (workId: string) => {
    if (currentWork?.id === workId) {
      setCurrentWork({
        ...currentWork,
        isMalfunctioning: !currentWork.isMalfunctioning,
      });
    }
    setTodaysWorks((prev) =>
      prev.map((work) =>
        work.id === workId
          ? { ...work, isMalfunctioning: !work.isMalfunctioning }
          : work,
      ),
    );
    setPastWorks((prev) =>
      prev.map((work) =>
        work.id === workId
          ? { ...work, isMalfunctioning: !work.isMalfunctioning }
          : work,
      ),
    );
  };

  const completeMaintenance = (workId: string) => {
    const endTime = new Date();
    const workToArchive =
      currentWork?.id === workId
        ? currentWork
        : todaysWorks.find((work) => work.id === workId);

    if (currentWork?.id === workId) {
      setCurrentWork({ ...currentWork, status: "completed", endTime });
    }
    setTodaysWorks((prev) =>
      prev.map((work) =>
        work.id === workId ? { ...work, status: "completed", endTime } : work,
      ),
    );
    if (workToArchive) {
      setPastWorks((prev) => {
        if (prev.some((work) => work.id === workId)) {
          return prev;
        }
        return [
          { ...workToArchive, status: "completed", endTime },
          ...prev,
        ];
      });
    }
    setCurrentWork(null);
  };

  const abortMaintenance = (workId: string) => {
    setTodaysWorks((prev) => prev.filter((work) => work.id !== workId));
    if (currentWork?.id === workId) {
      setCurrentWork(null);
    }
  };

  const markEdited = (workId: string) => {
    const timestamp = new Date();
    if (currentWork?.id === workId) {
      setCurrentWork({ ...currentWork, lastEdited: timestamp });
    }
    setTodaysWorks((prev) =>
      prev.map((work) => (work.id === workId ? { ...work, lastEdited: timestamp } : work)),
    );
    setPastWorks((prev) =>
      prev.map((work) => (work.id === workId ? { ...work, lastEdited: timestamp } : work)),
    );
  };

  const closeWorkday = () => {
    setTodaysWorks([]);
    setCurrentWork(null);
    setWorkdayClosed(true);
  };

  const resetMaintenance = async () => {
    let didClearPhotos = true;
    if (user?.tenantId && user.id) {
      await clearMaintenanceState(user.tenantId, user.id).catch((error) => {
        console.warn("Nem sikerült törölni a karbantartási állapotot.", error);
      });
    }
    try {
      await clearPhotos();
    } catch (error) {
      didClearPhotos = false;
      console.warn("Nem sikerült törölni a fotókat.", error);
    }
    setCurrentWork(null);
    setTodaysWorks([]);
    setPastWorks([]);
    setWorkdayClosed(false);
    return didClearPhotos;
  };

  return (
    <MaintenanceContext.Provider
      value={{
        currentWork,
        todaysWorks,
        pastWorks,
        workdayClosed,
        shiftManager,
        startMaintenance,
        updateNotes,
        addPhoto,
        toggleMalfunction,
        completeMaintenance,
        abortMaintenance,
        markEdited,
        closeWorkday,
        resetMaintenance,
      }}
    >
      {children}
    </MaintenanceContext.Provider>
  );
}

export function useMaintenance() {
  const context = useContext(MaintenanceContext);
  if (!context) {
    throw new Error("useMaintenance must be used within a MaintenanceProvider");
  }
  return context;
}
