import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { MaintenancePhoto, MaintenanceWork, ShiftManager } from "@/types/maintenance";
import { useDemoUser } from "@/context/DemoUserContext";
import { getCachedBuildingSnapshot } from "@noma/shared";
import {
  clearMaintenanceState,
  enqueueMaintenancePhotoSync,
  enqueueMaintenanceWorkSync,
  loadMaintenanceState,
  saveMaintenanceState,
  startMaintenanceOfflineSyncRunner,
  stopMaintenanceOfflineSyncRunner,
  triggerMaintenanceOfflineSyncNow,
} from "@/lib/maintenanceStore";
import { clearPhotos, getPhotosByIds, purgeDemoPhotos, savePhoto } from "@/lib/photoStore";
import { createUuid, isUuid } from "@/lib/uuid";

interface MaintenanceContextType {
  currentWork: MaintenanceWork | null;
  todaysWorks: MaintenanceWork[];
  pastWorks: MaintenanceWork[];
  workdayClosed: boolean;
  shiftManager: ShiftManager;
  startMaintenance: (hvacId: string) => Promise<string | null>;
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
  deviceId: string;
  model: string;
  kind: string;
  address: string;
  location: string;
};

const createWorkId = () => {
  return createUuid();
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

const deserializeWork = (work: StoredMaintenanceWork): MaintenanceWork | null => {
  const candidate = work as MaintenanceWork;
  if (!isUuid(candidate.id) || !isUuid(candidate.shiftId) || !isUuid(candidate.deviceId)) {
    return null;
  }

  return {
    ...candidate,
    startTime: new Date(work.startTime),
    endTime: work.endTime ? new Date(work.endTime) : undefined,
    lastEdited: work.lastEdited ? new Date(work.lastEdited) : undefined,
    photos: (work.photos ?? [])
      .map((photo) => {
        const legacy = photo as StoredMaintenancePhoto & { url?: string };
        if (!isUuid(legacy.id)) {
          return null;
        }
        return {
          id: legacy.id,
          url: legacy.url ?? "",
          description: legacy.description ?? "",
          timestamp: new Date(legacy.timestamp),
        };
      })
      .filter((photo): photo is MaintenancePhoto => Boolean(photo)),
  };
};

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
  const [currentShiftId, setCurrentShiftId] = useState<string | null>(null);

  const shiftManager: ShiftManager = {
    name: "Ivanics Károly",
    phone: "+36301234567",
  };

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

  const loadCurrentShiftDeviceLookup = async (): Promise<{
    lookup: Map<string, DeviceCacheLookupEntry>;
    shiftId: string | null;
  }> => {
    if (!user?.tenantId) {
      return { lookup: new Map(), shiftId: null };
    }

    const currentShiftResponse = await fetch("/api/shifts/current", {
      credentials: "include",
      cache: "no-store",
    });
    if (!currentShiftResponse.ok) {
      return { lookup: new Map(), shiftId: null };
    }

    const currentShiftPayload = (await currentShiftResponse.json()) as {
      shift: { id: string } | null;
    };
    const shiftId = currentShiftPayload.shift?.id ?? null;
    if (!shiftId) {
      return { lookup: new Map(), shiftId: null };
    }

    const waitingRoomResponse = await fetch(`/api/shifts/${shiftId}/waiting-room`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!waitingRoomResponse.ok) {
      return { lookup: new Map(), shiftId: null };
    }

    const waitingRoomPayload = (await waitingRoomResponse.json()) as { building_id: string };
    const snapshot = await getCachedBuildingSnapshot(user.tenantId, waitingRoomPayload.building_id);
    if (!snapshot) {
      return { lookup: new Map(), shiftId };
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

    const lookup = new Map<string, DeviceCacheLookupEntry>();
    for (const device of snapshot.devices) {
      const code = device.code?.trim();
      if (!code) {
        continue;
      }
      lookup.set(code, {
        deviceId: device.id,
        model: device.model?.trim() || "Ismeretlen modell",
        kind: device.kind?.trim() || "UNKNOWN",
        address: snapshot.building.address?.trim() || "Ismeretlen cím",
        location:
          (device.location_id ? locationById.get(device.location_id) : null) ||
          "Ismeretlen helyszín",
      });
    }

    return { lookup, shiftId };
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

        const nextCurrentWork = persisted?.currentWork
          ? deserializeWork(persisted.currentWork)
          : null;
        const nextTodaysWorks = (persisted?.todaysWorks ?? [])
          .map(deserializeWork)
          .filter((work): work is MaintenanceWork => Boolean(work));
        const nextPastWorks = (persisted?.pastWorks ?? [])
          .map(deserializeWork)
          .filter((work): work is MaintenanceWork => Boolean(work));

        setCurrentWork(nextCurrentWork);
        setTodaysWorks(nextTodaysWorks);
        setPastWorks(nextPastWorks);
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
    if (!user?.tenantId || !user.id) {
      stopMaintenanceOfflineSyncRunner();
      return;
    }
    startMaintenanceOfflineSyncRunner();
    triggerMaintenanceOfflineSyncNow();
    return () => {
      stopMaintenanceOfflineSyncRunner();
    };
  }, [user?.tenantId, user?.id]);

  useEffect(() => {
    let cancelled = false;

    const loadDeviceLookup = async () => {
      if (!user?.tenantId) {
        if (!cancelled) {
          setDeviceLookup(new Map());
          setCurrentShiftId(null);
        }
        return;
      }

      try {
        const { lookup, shiftId } = await loadCurrentShiftDeviceLookup();

        if (!cancelled) {
          setDeviceLookup(lookup);
          setCurrentShiftId(shiftId);
        }
      } catch {
        if (!cancelled) {
          setDeviceLookup(new Map());
          setCurrentShiftId(null);
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

  const queueWorkSync = (work: MaintenanceWork) => {
    const status = work.status === "completed" ? "FINISHED" : "IN_PROGRESS";
    const malfunctionDescription = work.isMalfunctioning
      ? work.notes.trim() || null
      : null;
    enqueueMaintenanceWorkSync({
      workId: work.id,
      shiftId: work.shiftId,
      deviceId: work.deviceId,
      status,
      startedAt: work.startTime.toISOString(),
      finishedAt: status === "FINISHED" ? (work.endTime?.toISOString() ?? null) : null,
      abortedAt: null,
      malfunctionDescription,
      note: work.notes.trim() || null,
    })
      .then(() => {
        triggerMaintenanceOfflineSyncNow();
      })
      .catch((error) => {
        console.warn("Nem sikerült sorba állítani a karbantartás szinkronizációját.", error);
      });
  };

  const queuePhotoSync = (work: MaintenanceWork, photo: MaintenancePhoto) => {
    enqueueMaintenancePhotoSync({
      workId: work.id,
      photoId: photo.id,
      captureNote: photo.description.trim() || null,
      capturedAt: photo.timestamp.toISOString(),
      photoType: work.isMalfunctioning ? "MALFUNCTION" : "MAINTENANCE",
    })
      .then(() => {
        triggerMaintenanceOfflineSyncNow();
      })
      .catch((error) => {
        console.warn("Nem sikerült sorba állítani a fotó szinkronizációját.", error);
      });
  };

  const startMaintenance = async (hvacId: string): Promise<string | null> => {
    setWorkdayClosed(false);
    let resolvedShiftId = currentShiftId;
    let hvacInfo = deviceLookup.get(hvacId);

    if (!hvacInfo || !resolvedShiftId) {
      try {
        const { lookup, shiftId } = await loadCurrentShiftDeviceLookup();
        setDeviceLookup(lookup);
        setCurrentShiftId(shiftId);
        resolvedShiftId = shiftId;
        hvacInfo = lookup.get(hvacId);
      } catch {
        return null;
      }
    }

    if (!hvacInfo || !resolvedShiftId) {
      return null;
    }

    const newWork: MaintenanceWork = {
      id: createWorkId(),
      shiftId: resolvedShiftId,
      deviceId: hvacInfo.deviceId,
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
    queueWorkSync(newWork);

    return newWork.id;
  };

  const updateNotes = (workId: string, notes: string) => {
    let updatedWork: MaintenanceWork | null = null;
    if (currentWork?.id === workId) {
      updatedWork = { ...currentWork, notes };
      setCurrentWork(updatedWork);
    }
    setTodaysWorks((prev) =>
      prev.map((work) => {
        if (work.id !== workId) {
          return work;
        }
        const nextWork = { ...work, notes };
        updatedWork = nextWork;
        return nextWork;
      }),
    );
    setPastWorks((prev) =>
      prev.map((work) =>
        work.id === workId && work.status === "completed" ? { ...work, notes } : work,
      ),
    );
    if (updatedWork) {
      queueWorkSync(updatedWork);
    }
  };

  const addPhoto = (workId: string, photo: MaintenancePhoto) => {
    savePhoto(photo).catch((error) => {
      console.warn("Nem sikerült a fotót tárolni.", error);
    });
    let updatedWork: MaintenanceWork | null = null;
    if (currentWork?.id === workId) {
      updatedWork = {
        ...currentWork,
        photos: [...currentWork.photos, photo],
      };
      setCurrentWork(updatedWork);
    }
    setTodaysWorks((prev) =>
      prev.map((work) => {
        if (work.id !== workId) {
          return work;
        }
        const nextWork = { ...work, photos: [...work.photos, photo] };
        updatedWork = nextWork;
        return nextWork;
      }),
    );
    setPastWorks((prev) =>
      prev.map((work) =>
        work.id === workId && work.status === "completed"
          ? { ...work, photos: [...work.photos, photo] }
          : work,
      ),
    );
    if (updatedWork) {
      queuePhotoSync(updatedWork, photo);
    }
  };

  const toggleMalfunction = (workId: string) => {
    let updatedWork: MaintenanceWork | null = null;
    if (currentWork?.id === workId) {
      updatedWork = {
        ...currentWork,
        isMalfunctioning: !currentWork.isMalfunctioning,
      };
      setCurrentWork(updatedWork);
    }
    setTodaysWorks((prev) =>
      prev.map((work) => {
        if (work.id !== workId) {
          return work;
        }
        const nextWork = {
          ...work,
          isMalfunctioning: !work.isMalfunctioning,
        };
        updatedWork = nextWork;
        return nextWork;
      }),
    );
    setPastWorks((prev) =>
      prev.map((work) =>
        work.id === workId
          ? { ...work, isMalfunctioning: !work.isMalfunctioning }
          : work,
      ),
    );
    if (updatedWork) {
      queueWorkSync(updatedWork);
    }
  };

  const completeMaintenance = (workId: string) => {
    const endTime = new Date();
    const workToArchiveBase =
      currentWork?.id === workId
        ? currentWork
        : todaysWorks.find((work) => work.id === workId);
    const workToArchive = workToArchiveBase
      ? { ...workToArchiveBase, status: "completed" as const, endTime }
      : null;

    if (workToArchive) {
      queueWorkSync(workToArchive);
      for (const photo of workToArchive.photos) {
        queuePhotoSync(workToArchive, photo);
      }
    }

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
