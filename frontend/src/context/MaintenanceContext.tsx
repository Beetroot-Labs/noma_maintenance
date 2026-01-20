import { createContext, useContext, useState, ReactNode } from "react";
import type { MaintenancePhoto, MaintenanceWork, ShiftManager } from "@/types/maintenance";

interface MaintenanceContextType {
  currentWork: MaintenanceWork | null;
  todaysWorks: MaintenanceWork[];
  shiftManager: ShiftManager;
  startMaintenance: (hvacId: string) => string;
  updateNotes: (workId: string, notes: string) => void;
  addPhoto: (workId: string, photo: MaintenancePhoto) => void;
  toggleMalfunction: (workId: string) => void;
  completeMaintenance: (workId: string) => void;
  closeWorkday: () => void;
}

const MaintenanceContext = createContext<MaintenanceContextType | undefined>(undefined);

const hvacDatabase: Record<string, { model: string; location: string }> = {
  "HVAC-001": { model: "Carrier 24ACC636A003", location: "A épület - 2. emelet" },
  "HVAC-002": { model: "Trane XR15", location: "B épület - tető" },
  "HVAC-003": { model: "Lennox XC21", location: "A épület - pince" },
  "HVAC-004": { model: "Daikin DX20VC", location: "C épület - 1. emelet" },
  "HVAC-005": { model: "Rheem RA20", location: "D épület - 3. emelet" },
};

export function MaintenanceProvider({ children }: { children: ReactNode }) {
  const [currentWork, setCurrentWork] = useState<MaintenanceWork | null>(null);
  const [todaysWorks, setTodaysWorks] = useState<MaintenanceWork[]>([]);

  const shiftManager: ShiftManager = {
    name: "Michael Rodriguez",
    phone: "+1-555-0123",
  };

  const startMaintenance = (hvacId: string): string => {
    const hvacInfo = hvacDatabase[hvacId] || {
      model: "Ismeretlen modell",
      location: "Ismeretlen helyszín",
    };

    const newWork: MaintenanceWork = {
      id: `MW-${Date.now()}`,
      hvacId,
      hvacModel: hvacInfo.model,
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

    if (currentWork?.id === workId) {
      setCurrentWork({ ...currentWork, status: "completed", endTime });
    }
    setTodaysWorks((prev) =>
      prev.map((work) =>
        work.id === workId ? { ...work, status: "completed", endTime } : work,
      ),
    );
    setCurrentWork(null);
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
        shiftManager,
        startMaintenance,
        updateNotes,
        addPhoto,
        toggleMalfunction,
        completeMaintenance,
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
