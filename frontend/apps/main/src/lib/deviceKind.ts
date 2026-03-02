import { AirVent, BoomBox, CircleHelp, Droplets, Fan, RefreshCcwDot, Snowflake, Wind } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type DeviceKind =
  | "FAN_COIL_UNIT"
  | "INDOOR_UNIT"
  | "CONDENSER"
  | "FAN"
  | "AIR_HANDLER_UNIT"
  | "VRF_OUTDOOR_UNIT"
  | "CHILLER";

export const deviceKindLabels: Record<DeviceKind, string> = {
  FAN_COIL_UNIT: "Fan coil",
  INDOOR_UNIT: "Beltéri egység",
  CONDENSER: "Kondenzátor",
  FAN: "Ventilátor",
  AIR_HANDLER_UNIT: "Légkezelő",
  VRF_OUTDOOR_UNIT: "VRF kültéri egység",
  CHILLER: "Folyadékhűtő",
};

export const getDeviceKindLabel = (kind: DeviceKind) => deviceKindLabels[kind];

export const deviceKindIcons: Record<DeviceKind, LucideIcon> = {
  FAN_COIL_UNIT: Wind,
  INDOOR_UNIT: AirVent,
  CONDENSER: Droplets,
  FAN: Fan,
  AIR_HANDLER_UNIT: RefreshCcwDot,
  VRF_OUTDOOR_UNIT: BoomBox,
  CHILLER: Snowflake,
};

export const getDeviceKindIcon = (kind?: string): LucideIcon =>
  deviceKindIcons[kind as DeviceKind] ?? CircleHelp;
