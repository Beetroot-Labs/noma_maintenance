export type SharedCachedBuilding = {
  id: string;
  name: string;
  address: string;
};

export type SharedCachedLocation = {
  id: string;
  building_id: string;
  floor: string | null;
  wing: string | null;
  room: string | null;
  location_description: string | null;
};

export type SharedCachedDevice = {
  id: string;
  location_id: string | null;
  code: string | null;
  kind: string;
  additional_info: string | null;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  source_device_code: string | null;
  device_photo_url: string | null;
};

export type SharedBuildingCachePayload = {
  building: SharedCachedBuilding;
  locations: SharedCachedLocation[];
  devices: SharedCachedDevice[];
};

type CacheSnapshotRecord = {
  id: string;
  tenant_id: string;
  building_id: string;
  cached_at: string;
  payload: SharedBuildingCachePayload;
};

const DB_NAME = "noma-main";
const DB_VERSION = 1;
const SNAPSHOTS_STORE = "building_cache_snapshots";

const openCacheDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOTS_STORE)) {
        db.createObjectStore(SNAPSHOTS_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });

export const fetchBuildingCachePayload = async (
  buildingId: string,
): Promise<SharedBuildingCachePayload> => {
  const response = await fetch(`/api/labeling/buildings/${buildingId}/cache`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Nem sikerült letölteni az offline adatokat.");
  }
  return (await response.json()) as SharedBuildingCachePayload;
};

export const cacheBuildingSnapshot = async (
  tenantId: string,
  buildingId: string,
  payload: SharedBuildingCachePayload,
): Promise<void> => {
  const db = await openCacheDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SNAPSHOTS_STORE, "readwrite");
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();
    tx.objectStore(SNAPSHOTS_STORE).put({
      id: `${tenantId}:${buildingId}`,
      tenant_id: tenantId,
      building_id: buildingId,
      cached_at: new Date().toISOString(),
      payload,
    } satisfies CacheSnapshotRecord);
  });
};

export const getCachedBuildingSnapshot = async (
  tenantId: string,
  buildingId: string,
): Promise<SharedBuildingCachePayload | null> => {
  const db = await openCacheDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SNAPSHOTS_STORE, "readonly");
    tx.onerror = () => reject(tx.error);
    const request = tx.objectStore(SNAPSHOTS_STORE).get(`${tenantId}:${buildingId}`);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const record = request.result as CacheSnapshotRecord | undefined;
      resolve(record?.payload ?? null);
    };
  });
};
