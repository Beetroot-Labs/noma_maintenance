const DB_NAME = "noma-labeling";
const DB_VERSION = 1;
const BUILDINGS_STORE = "buildings";
const LOCATIONS_STORE = "locations";
const DEVICES_STORE = "devices";
const SETTINGS_STORE = "settings";

export type CachedBuilding = {
  id: string;
  name: string;
  address: string;
};

export type CachedLocation = {
  id: string;
  building_id: string;
  floor: string | null;
  wing: string | null;
  room: string | null;
  location_description: string | null;
};

export type CachedDevice = {
  id: string;
  location_id: string | null;
  kind: string;
  additional_info: string | null;
  brand: string | null;
  model: string | null;
  device_photo_url: string | null;
};

export type BuildingCachePayload = {
  building: CachedBuilding;
  locations: CachedLocation[];
  devices: CachedDevice[];
};

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BUILDINGS_STORE)) {
        db.createObjectStore(BUILDINGS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(LOCATIONS_STORE)) {
        db.createObjectStore(LOCATIONS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(DEVICES_STORE)) {
        db.createObjectStore(DEVICES_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });

const countStore = async (storeName: string): Promise<number> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const request = store.count();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
};

const getSetting = async <T>(key: string): Promise<T | null> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SETTINGS_STORE, "readonly");
    const store = tx.objectStore(SETTINGS_STORE);
    const request = store.get(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve((request.result?.value as T | undefined) ?? null);
  });
};

const getRecord = async <T>(storeName: string, key: string): Promise<T | null> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const request = store.get(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
  });
};

export const hasOfflineCache = async (): Promise<boolean> => {
  const [buildingCount, deviceCount] = await Promise.all([
    countStore(BUILDINGS_STORE),
    countStore(DEVICES_STORE),
  ]);
  return buildingCount > 0 && deviceCount > 0;
};

export const cacheBuildingData = async (
  payload: BuildingCachePayload,
  selectedBuildingId: string,
): Promise<void> => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(
      [BUILDINGS_STORE, LOCATIONS_STORE, DEVICES_STORE, SETTINGS_STORE],
      "readwrite",
    );

    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();

    tx.objectStore(BUILDINGS_STORE).clear();
    tx.objectStore(LOCATIONS_STORE).clear();
    tx.objectStore(DEVICES_STORE).clear();

    tx.objectStore(BUILDINGS_STORE).put(payload.building);
    payload.locations.forEach((location) => {
      tx.objectStore(LOCATIONS_STORE).put(location);
    });
    payload.devices.forEach((device) => {
      tx.objectStore(DEVICES_STORE).put(device);
    });
    tx.objectStore(SETTINGS_STORE).put({
      key: "selectedBuildingId",
      value: selectedBuildingId,
    });
    tx.objectStore(SETTINGS_STORE).put({
      key: "cacheReadyAt",
      value: new Date().toISOString(),
    });
  });
};

export const getSelectedCachedBuilding = async (): Promise<CachedBuilding | null> => {
  const selectedBuildingId = await getSetting<string>("selectedBuildingId");
  if (!selectedBuildingId) {
    return null;
  }

  return getRecord<CachedBuilding>(BUILDINGS_STORE, selectedBuildingId);
};
