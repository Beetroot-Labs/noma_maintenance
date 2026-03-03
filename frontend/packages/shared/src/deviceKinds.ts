const deviceKindLabels = {
  WINDOW_AIR_CONDITIONER: "Ablakklíma",
  FAN_COIL: "Fan-coil",
  COMFORT_FAN_COIL: "Komfort fan-coil",
  AIR_CURTAIN: "Légfüggöny",
  SPLIT_UNIT: "Split klíma",
  SPLIT_INDOOR_UNIT: "Split beltéri egység",
  SERVER_ROOM_SPLIT_INDOOR_UNIT: "Szervertermi split beltéri egység",
  AIR_HANDLING_UNIT: "Légkezelő",
  VRV_INDOOR_UNIT: "VRV beltéri egység",
  VRV_OUTDOOR_UNIT: "VRV kültéri egység",
  CONDENSER: "Kondenzátor",
  FAN: "Ventilátor",
  LIQUID_CHILLER: "Folyadékhűtő",
} as const;

export type DeviceKind = keyof typeof deviceKindLabels;

export const getDeviceKindLabel = (deviceKind: string): string =>
  deviceKindLabels[deviceKind as DeviceKind] ?? deviceKind;

export { deviceKindLabels };
