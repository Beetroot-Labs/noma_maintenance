const devicesStateStorageKey = "adminDevices:lastState";

type AdminDevicesState = {
  search: string;
  buildingName: string | null;
};

export const getAdminDevicesStateStorageKey = () => devicesStateStorageKey;

export const storeAdminDevicesStateForBuilding = (buildingId: string, buildingName: string | null) => {
  if (typeof window === "undefined") {
    return;
  }

  const params = new URLSearchParams();
  params.set("buildingId", buildingId);

  window.sessionStorage.setItem(
    devicesStateStorageKey,
    JSON.stringify({
      search: params.toString(),
      buildingName,
    } satisfies AdminDevicesState),
  );
};
