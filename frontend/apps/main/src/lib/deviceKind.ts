import { AirVent, BoomBox, CircleHelp, Droplets, Fan, Grid2x2, RefreshCcwDot, Snowflake, SunSnow, Wind } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type DeviceKind =
  | "WINDOW_AIR_CONDITIONER"
  | "FAN_COIL"
  | "COMFORT_FAN_COIL"
  | "AIR_CURTAIN"
  | "FAN_COIL_UNIT"
  | "SPLIT_UNIT"
  | "SPLIT_INDOOR_UNIT"
  | "SERVER_ROOM_SPLIT_INDOOR_UNIT"
  | "INDOOR_UNIT"
  | "AIR_HANDLING_UNIT"
  | "CONDENSER"
  | "FAN"
  | "AIR_HANDLER_UNIT"
  | "VRV_INDOOR_UNIT"
  | "VRV_OUTDOOR_UNIT"
  | "VRF_OUTDOOR_UNIT"
  | "LIQUID_CHILLER"
  | "CHILLER";

export const deviceKindLabels: Record<DeviceKind, string> = {
  WINDOW_AIR_CONDITIONER: "Ablakklíma",
  FAN_COIL: "Fan-coil",
  COMFORT_FAN_COIL: "Komfort fan-coil",
  AIR_CURTAIN: "Légfüggöny",
  FAN_COIL_UNIT: "Fan coil",
  SPLIT_UNIT: "Split klíma",
  SPLIT_INDOOR_UNIT: "Split beltéri egység",
  SERVER_ROOM_SPLIT_INDOOR_UNIT: "Szervertermi split beltéri egység",
  INDOOR_UNIT: "Beltéri egység",
  AIR_HANDLING_UNIT: "Légkezelő",
  CONDENSER: "Kondenzátor",
  FAN: "Ventilátor",
  AIR_HANDLER_UNIT: "Légkezelő",
  VRV_INDOOR_UNIT: "VRV beltéri egység",
  VRV_OUTDOOR_UNIT: "VRV kültéri egység",
  VRF_OUTDOOR_UNIT: "VRF kültéri egység",
  LIQUID_CHILLER: "Folyadékhűtő",
  CHILLER: "Folyadékhűtő",
};

export const getDeviceKindLabel = (kind: DeviceKind) => deviceKindLabels[kind];

export const deviceKindIcons: Record<DeviceKind, LucideIcon> = {
  WINDOW_AIR_CONDITIONER: Grid2x2,
  FAN_COIL: Wind,
  COMFORT_FAN_COIL: Wind,
  AIR_CURTAIN: AirVent,
  FAN_COIL_UNIT: Wind,
  SPLIT_UNIT: SunSnow,
  SPLIT_INDOOR_UNIT: AirVent,
  SERVER_ROOM_SPLIT_INDOOR_UNIT: AirVent,
  INDOOR_UNIT: AirVent,
  AIR_HANDLING_UNIT: RefreshCcwDot,
  CONDENSER: Droplets,
  FAN: Fan,
  AIR_HANDLER_UNIT: RefreshCcwDot,
  VRV_INDOOR_UNIT: AirVent,
  VRV_OUTDOOR_UNIT: BoomBox,
  VRF_OUTDOOR_UNIT: BoomBox,
  LIQUID_CHILLER: Snowflake,
  CHILLER: Snowflake,
};

export const getDeviceKindIcon = (kind?: string): LucideIcon =>
  deviceKindIcons[kind as DeviceKind] ?? CircleHelp;
