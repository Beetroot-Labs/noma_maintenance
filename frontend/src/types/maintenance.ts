export interface MaintenancePhoto {
  id: string;
  url: string;
  description: string;
  timestamp: Date;
}

export interface MaintenanceWork {
  id: string;
  hvacId: string;
  hvacModel: string;
  hvacLocation: string;
  status: "in-progress" | "completed";
  isMalfunctioning: boolean;
  notes: string;
  photos: MaintenancePhoto[];
  startTime: Date;
  endTime?: Date;
}

export interface ShiftManager {
  name: string;
  phone: string;
}
