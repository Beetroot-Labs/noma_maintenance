export type DeviceFilterKey =
  | "code"
  | "floor"
  | "wing"
  | "room"
  | "locationDescription"
  | "kind"
  | "originalKind"
  | "brand"
  | "model"
  | "sourceDeviceCode"
  | "additionalInfo";

export type DeviceColumnFilterState = Record<DeviceFilterKey, string>;

export const emptyDeviceColumnFilters: DeviceColumnFilterState = {
  code: "",
  floor: "",
  wing: "",
  room: "",
  locationDescription: "",
  kind: "",
  originalKind: "",
  brand: "",
  model: "",
  sourceDeviceCode: "",
  additionalInfo: "",
};
