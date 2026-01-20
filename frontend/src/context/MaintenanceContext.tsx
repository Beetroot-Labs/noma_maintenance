import { createContext, useContext, useState, ReactNode } from "react";
import type { MaintenancePhoto, MaintenanceWork, ShiftManager } from "@/types/maintenance";

interface MaintenanceContextType {
  currentWork: MaintenanceWork | null;
  todaysWorks: MaintenanceWork[];
  pastWorks: MaintenanceWork[];
  shiftManager: ShiftManager;
  startMaintenance: (hvacId: string) => string;
  updateNotes: (workId: string, notes: string) => void;
  addPhoto: (workId: string, photo: MaintenancePhoto) => void;
  toggleMalfunction: (workId: string) => void;
  completeMaintenance: (workId: string) => void;
  abortMaintenance: (workId: string) => void;
  closeWorkday: () => void;
}

const MaintenanceContext = createContext<MaintenanceContextType | undefined>(undefined);

export const hvacDatabase: Record<
  string,
  { model: string; kind: string; address: string; location: string }
> = {
  "DEMO-DEVICE-001": {
    model: "Daikin FXFQ-A",
    kind: "FAN_COIL_UNIT",
    address: "Budapest, Vaci ut 1",
    location: "2. emelet, 201. szoba",
  },
  "DEMO-DEVICE-002": {
    model: "Mitsubishi MSZ-AP",
    kind: "INDOOR_UNIT",
    address: "Budapest, Vaci ut 1",
    location: "3. emelet, 305. szoba",
  },
  "DEMO-DEVICE-003": {
    model: "Carrier 38QUS",
    kind: "CONDENSER",
    address: "Budapest, Vaci ut 1",
    location: "Tető, R1 zóna",
  },
  "DEMO-DEVICE-004": {
    model: "Systemair K-EC",
    kind: "FAN",
    address: "Budapest, Vaci ut 1",
    location: "1. emelet, 105. gépészet",
  },
  "DEMO-DEVICE-005": {
    model: "Swegon GOLD RX",
    kind: "AIR_HANDLER_UNIT",
    address: "Budapest, Vaci ut 1",
    location: "Pinceszint, B-12",
  },
  "DEMO-DEVICE-006": {
    model: "Daikin VRV IV",
    kind: "VRF_OUTDOOR_UNIT",
    address: "Budapest, Vaci ut 1",
    location: "Tető, R2 zóna",
  },
  "DEMO-DEVICE-007": {
    model: "Trane Sintesis",
    kind: "CHILLER",
    address: "Budapest, Vaci ut 1",
    location: "Pinceszint, B-21",
  },
  "DEMO-DEVICE-008": {
    model: "Daikin FXFQ-A",
    kind: "FAN_COIL_UNIT",
    address: "Budapest, Fehervari ut 12",
    location: "2. emelet, 215. tárgyaló",
  },
  "DEMO-DEVICE-009": {
    model: "Mitsubishi MSZ-AP",
    kind: "INDOOR_UNIT",
    address: "Budapest, Fehervari ut 12",
    location: "4. emelet, 410. iroda",
  },
  "DEMO-DEVICE-010": {
    model: "Carrier 38QUS",
    kind: "CONDENSER",
    address: "Budapest, Fehervari ut 12",
    location: "Tető, R1 zóna",
  },
  "DEMO-DEVICE-011": {
    model: "Systemair K-EC",
    kind: "FAN",
    address: "Budapest, Fehervari ut 12",
    location: "1. emelet, 112. folyosó",
  },
  "DEMO-DEVICE-012": {
    model: "Swegon GOLD RX",
    kind: "AIR_HANDLER_UNIT",
    address: "Budapest, Fehervari ut 12",
    location: "Pinceszint, B-07",
  },
  "DEMO-DEVICE-013": {
    model: "Daikin VRV IV",
    kind: "VRF_OUTDOOR_UNIT",
    address: "Budapest, Fehervari ut 12",
    location: "Tető, R2 zóna",
  },
  "DEMO-DEVICE-014": {
    model: "Trane Sintesis",
    kind: "CHILLER",
    address: "Budapest, Fehervari ut 12",
    location: "Pinceszint, B-19",
  },
  "DEMO-DEVICE-015": {
    model: "Daikin FXFQ-A",
    kind: "FAN_COIL_UNIT",
    address: "Szentendre, Ipari ut 5",
    location: "1. emelet, A-03 csarnok",
  },
  "DEMO-DEVICE-016": {
    model: "Mitsubishi MSZ-AP",
    kind: "INDOOR_UNIT",
    address: "Szentendre, Ipari ut 5",
    location: "1. emelet, A-08 raktár",
  },
  "DEMO-DEVICE-017": {
    model: "Carrier 38QUS",
    kind: "CONDENSER",
    address: "Szentendre, Ipari ut 5",
    location: "Tető, R1 zóna",
  },
  "DEMO-DEVICE-018": {
    model: "Systemair K-EC",
    kind: "FAN",
    address: "Szentendre, Ipari ut 5",
    location: "2. emelet, B-12 karbantartás",
  },
  "DEMO-DEVICE-019": {
    model: "Swegon GOLD RX",
    kind: "AIR_HANDLER_UNIT",
    address: "Szentendre, Ipari ut 5",
    location: "Pinceszint, B-01",
  },
  "DEMO-DEVICE-020": {
    model: "Daikin VRV IV",
    kind: "VRF_OUTDOOR_UNIT",
    address: "Szentendre, Ipari ut 5",
    location: "Tető, R2 zóna",
  },
};

const initialPastWorks: MaintenanceWork[] = [
  {
    id: "MW-PAST-001",
    hvacId: "DEMO-DEVICE-009",
    hvacModel: "Mitsubishi MSZ-AP",
    hvacKind: "INDOOR_UNIT",
    hvacAddress: "Budapest, Fehervari ut 12",
    hvacLocation: "4. emelet, 410. iroda",
    status: "completed",
    isMalfunctioning: false,
    notes: "Szűrők cserélve.",
    photos: [],
    startTime: new Date(Date.now() - 1000 * 60 * 60 * 26),
    endTime: new Date(Date.now() - 1000 * 60 * 60 * 25),
  },
  {
    id: "MW-PAST-002",
    hvacId: "DEMO-DEVICE-004",
    hvacModel: "Systemair K-EC",
    hvacKind: "FAN",
    hvacAddress: "Budapest, Vaci ut 1",
    hvacLocation: "1. emelet, 105. gépészet",
    status: "completed",
    isMalfunctioning: true,
    notes: "Szivárgás gyanú, jelölve javításra.",
    photos: [],
    startTime: new Date(Date.now() - 1000 * 60 * 60 * 50),
    endTime: new Date(Date.now() - 1000 * 60 * 60 * 49),
  },
];

export function MaintenanceProvider({ children }: { children: ReactNode }) {
  const [currentWork, setCurrentWork] = useState<MaintenanceWork | null>(null);
  const [todaysWorks, setTodaysWorks] = useState<MaintenanceWork[]>([]);
  const [pastWorks, setPastWorks] = useState<MaintenanceWork[]>(initialPastWorks);

  const shiftManager: ShiftManager = {
    name: "Ivanics Károly",
    phone: "+36301234567",
  };

  const startMaintenance = (hvacId: string): string => {
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
  };

  const addPhoto = (workId: string, photo: MaintenancePhoto) => {
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

  const closeWorkday = () => {
    setTodaysWorks([]);
    setCurrentWork(null);
  };

  return (
    <MaintenanceContext.Provider
      value={{
        currentWork,
        todaysWorks,
        pastWorks,
        shiftManager,
        startMaintenance,
        updateNotes,
        addPhoto,
        toggleMalfunction,
        completeMaintenance,
        abortMaintenance,
        closeWorkday,
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
