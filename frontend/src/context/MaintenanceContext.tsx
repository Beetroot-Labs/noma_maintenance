import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import type { MaintenancePhoto, MaintenanceWork, ShiftManager } from "@/types/maintenance";
import { useDemoUser } from "@/context/DemoUserContext";
import { clearPhotos, demoPhotoIds, getPhotosByIds, savePhoto, seedDemoPhotos } from "@/lib/photoStore";

interface MaintenanceContextType {
  currentWork: MaintenanceWork | null;
  todaysWorks: MaintenanceWork[];
  pastWorks: MaintenanceWork[];
  workdayClosed: boolean;
  shiftManager: ShiftManager;
  startMaintenance: (hvacId: string) => string;
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
const maintenanceStorageKey = "noma:maintenance-state";
const demoWorkPrefix = "MW-PAST-";
const maxPersistedPastWorks = 50;

const isDemoWork = (workId: string) => workId.startsWith(demoWorkPrefix);

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

export const hvacDatabase: Record<
  string,
  { model: string; kind: string; address: string; location: string }
> = {
  "DEMO-DEVICE-001": {
    model: "Daikin FXFQ-A",
    kind: "FAN_COIL_UNIT",
    address: "Budapest, Váci út 1",
    location: "2. emelet, 201. szoba",
  },
  "DEMO-DEVICE-002": {
    model: "Mitsubishi MSZ-AP",
    kind: "INDOOR_UNIT",
    address: "Budapest, Váci út 1",
    location: "3. emelet, 305. szoba",
  },
  "DEMO-DEVICE-003": {
    model: "Carrier 38QUS",
    kind: "CONDENSER",
    address: "Budapest, Váci út 1",
    location: "Tető, R1 zóna",
  },
  "DEMO-DEVICE-004": {
    model: "Systemair K-EC",
    kind: "FAN",
    address: "Budapest, Váci út 1",
    location: "1. emelet, 105. gépészet",
  },
  "DEMO-DEVICE-005": {
    model: "Swegon GOLD RX",
    kind: "AIR_HANDLER_UNIT",
    address: "Budapest, Váci út 1",
    location: "Pinceszint, B-12",
  },
  "DEMO-DEVICE-006": {
    model: "Daikin VRV IV",
    kind: "VRF_OUTDOOR_UNIT",
    address: "Budapest, Váci út 1",
    location: "Tető, R2 zóna",
  },
  "DEMO-DEVICE-007": {
    model: "Trane Sintesis",
    kind: "CHILLER",
    address: "Budapest, Váci út 1",
    location: "Pinceszint, B-21",
  },
  "DEMO-DEVICE-008": {
    model: "Daikin FXFQ-A",
    kind: "FAN_COIL_UNIT",
    address: "Budapest, Fehérvári út 12",
    location: "2. emelet, 215. tárgyaló",
  },
  "DEMO-DEVICE-009": {
    model: "Mitsubishi MSZ-AP",
    kind: "INDOOR_UNIT",
    address: "Budapest, Fehérvári út 12",
    location: "4. emelet, 410. iroda",
  },
  "DEMO-DEVICE-010": {
    model: "Carrier 38QUS",
    kind: "CONDENSER",
    address: "Budapest, Fehérvári út 12",
    location: "Tető, R1 zóna",
  },
  "DEMO-DEVICE-011": {
    model: "Systemair K-EC",
    kind: "FAN",
    address: "Budapest, Fehérvári út 12",
    location: "1. emelet, 112. folyosó",
  },
  "DEMO-DEVICE-012": {
    model: "Swegon GOLD RX",
    kind: "AIR_HANDLER_UNIT",
    address: "Budapest, Fehérvári út 12",
    location: "Pinceszint, B-07",
  },
  "DEMO-DEVICE-013": {
    model: "Daikin VRV IV",
    kind: "VRF_OUTDOOR_UNIT",
    address: "Budapest, Fehérvári út 12",
    location: "Tető, R2 zóna",
  },
  "DEMO-DEVICE-014": {
    model: "Trane Sintesis",
    kind: "CHILLER",
    address: "Budapest, Fehérvári út 12",
    location: "Pinceszint, B-19",
  },
  "DEMO-DEVICE-015": {
    model: "Daikin FXFQ-A",
    kind: "FAN_COIL_UNIT",
    address: "Szentendre, Ipari út 5",
    location: "1. emelet, A-03 csarnok",
  },
  "DEMO-DEVICE-016": {
    model: "Mitsubishi MSZ-AP",
    kind: "INDOOR_UNIT",
    address: "Szentendre, Ipari út 5",
    location: "1. emelet, A-08 raktár",
  },
  "DEMO-DEVICE-017": {
    model: "Carrier 38QUS",
    kind: "CONDENSER",
    address: "Szentendre, Ipari út 5",
    location: "Tető, R1 zóna",
  },
  "DEMO-DEVICE-018": {
    model: "Systemair K-EC",
    kind: "FAN",
    address: "Szentendre, Ipari út 5",
    location: "2. emelet, B-12 karbantartás",
  },
  "DEMO-DEVICE-019": {
    model: "Swegon GOLD RX",
    kind: "AIR_HANDLER_UNIT",
    address: "Szentendre, Ipari út 5",
    location: "Pinceszint, B-01",
  },
  "DEMO-DEVICE-020": {
    model: "Daikin VRV IV",
    kind: "VRF_OUTDOOR_UNIT",
    address: "Szentendre, Ipari út 5",
    location: "Tető, R2 zóna",
  },
};

const generatePastWorks = () => {
  const works: MaintenanceWork[] = [];
  const now = new Date();
  const intervalMonths = 6;
  const totalIntervals = 6;

  Object.entries(hvacDatabase).forEach(([hvacId, device], deviceIndex) => {
    for (let i = 1; i <= totalIntervals; i += 1) {
      const endTime = new Date(now);
      endTime.setMonth(endTime.getMonth() - intervalMonths * i);
      const daysInMonth = new Date(endTime.getFullYear(), endTime.getMonth() + 1, 0).getDate();
      const dayOffset = (deviceIndex * 7 + i * 13) % daysInMonth;
      endTime.setDate(Math.max(1, dayOffset + 1));
      endTime.setHours(9 + (deviceIndex % 6), (i * 7) % 60, 0, 0);
      const startTime = new Date(endTime);
      startTime.setMinutes(endTime.getMinutes() - 45);

      works.push({
        id: `MW-PAST-${hvacId}-${i.toString().padStart(2, "0")}`,
        hvacId,
        hvacModel: device.model,
        hvacKind: device.kind,
        hvacAddress: device.address,
        hvacLocation: device.location,
        executorId: "u-tech",
        status: "completed",
        isMalfunctioning: false,
        notes: "Rutin karbantartás.",
        photos: [],
        startTime,
        endTime,
      });
    }
  });

  return works;
};

const initialPastWorks: MaintenanceWork[] = generatePastWorks();

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

const getInitialState = () => {
  if (typeof window === "undefined") {
    return {
      currentWork: null,
      todaysWorks: [],
      pastWorks: initialPastWorks,
      workdayClosed: false,
    };
  }

  const stored = window.localStorage.getItem(maintenanceStorageKey);
  if (!stored) {
    return {
      currentWork: null,
      todaysWorks: [],
      pastWorks: initialPastWorks,
      workdayClosed: false,
    };
  }

  try {
    const parsed = JSON.parse(stored) as StoredMaintenanceState;
    const hydratedPastWorks = (() => {
      const merged = new Map<string, MaintenanceWork>();
      for (const work of initialPastWorks) {
        merged.set(work.id, work);
      }
      for (const work of parsed.pastWorks ?? []) {
        const hydrated = deserializeWork(work);
        merged.set(hydrated.id, hydrated);
      }
      return Array.from(merged.values());
    })();
    return {
      currentWork: parsed.currentWork ? deserializeWork(parsed.currentWork) : null,
      todaysWorks: (parsed.todaysWorks ?? []).map(deserializeWork),
      pastWorks: hydratedPastWorks,
      workdayClosed: parsed.workdayClosed ?? false,
    };
  } catch {
    return {
      currentWork: null,
      todaysWorks: [],
      pastWorks: initialPastWorks,
      workdayClosed: false,
    };
  }
};

export function MaintenanceProvider({ children }: { children: ReactNode }) {
  const { user } = useDemoUser();
  const initialState = useMemo(() => getInitialState(), []);
  const [currentWork, setCurrentWork] = useState<MaintenanceWork | null>(
    initialState.currentWork,
  );
  const [todaysWorks, setTodaysWorks] = useState<MaintenanceWork[]>(
    initialState.todaysWorks,
  );
  const [pastWorks, setPastWorks] = useState<MaintenanceWork[]>(initialState.pastWorks);
  const [workdayClosed, setWorkdayClosed] = useState(initialState.workdayClosed);

  const shiftManager: ShiftManager = {
    name: "Ivanics Károly",
    phone: "+36301234567",
  };

  useEffect(() => {
    let isActive = true;

    const loadDemoPhotos = async () => {
      try {
        await seedDemoPhotos();
        const demoPhotos = await getPhotosByIds(demoPhotoIds);

        if (!isActive) return;
        if (demoPhotos.length === 0) return;
        setPastWorks((prev) =>
          prev.map((work, index) => {
            if (work.photos.length > 0) return work;
            const primary = demoPhotos[index % demoPhotos.length];
            const secondary = demoPhotos[(index + 3) % demoPhotos.length];
            const tertiary = demoPhotos[(index + 5) % demoPhotos.length];
            const photos = [primary];
            if (index % 3 === 0 && secondary.id !== primary.id) {
              photos.push(secondary);
            }
            if (index % 5 === 0 && tertiary.id !== primary.id && tertiary.id !== secondary.id) {
              photos.push(tertiary);
            }
            return { ...work, photos };
          }),
        );
      } catch (error) {
        console.warn("Nem sikerült betölteni a demó fotókat.", error);
      }
    };

    loadDemoPhotos();

    return () => {
      isActive = false;
    };
  }, []);

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
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
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
      .filter((work) => !isDemoWork(work.id))
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
    try {
      window.localStorage.setItem(maintenanceStorageKey, JSON.stringify(payload));
    } catch (error) {
      try {
        const minimalPayload: StoredMaintenanceState = {
          currentWork: currentWork ? serializeWork(currentWork) : null,
          todaysWorks: todaysWorks.map(serializeWork),
          pastWorks: [],
          workdayClosed,
        };
        window.localStorage.setItem(maintenanceStorageKey, JSON.stringify(minimalPayload));
      } catch (fallbackError) {
        window.localStorage.removeItem(maintenanceStorageKey);
        console.warn("Nem sikerült menteni a karbantartási adatokat.", fallbackError);
      }
    }
  }, [currentWork, pastWorks, todaysWorks, workdayClosed]);

  const startMaintenance = (hvacId: string): string => {
    setWorkdayClosed(false);
    const hvacInfo = hvacDatabase[hvacId] || {
      model: "Ismeretlen modell",
      kind: "UNKNOWN",
      address: "Ismeretlen cím",
      location: "Ismeretlen helyszín",
    };

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
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(maintenanceStorageKey);
    }
    try {
      await clearPhotos();
    } catch (error) {
      didClearPhotos = false;
      console.warn("Nem sikerült törölni a fotókat.", error);
    }
    setCurrentWork(null);
    setTodaysWorks([]);
    setPastWorks(initialPastWorks);
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
