const DB_NAME = "noma-labeling";
const DB_VERSION = 2;
const BUILDINGS_STORE = "buildings";
const LOCATIONS_STORE = "locations";
const DEVICES_STORE = "devices";
const DEVICE_PHOTOS_STORE = "device_photos";
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
  code?: string | null;
  kind: string;
  additional_info: string | null;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  source_device_code: string | null;
  device_photo_url: string | null;
};

export type BuildingCachePayload = {
  building: CachedBuilding;
  locations: CachedLocation[];
  devices: CachedDevice[];
};

export type CachedDeviceListItem = {
  id: string;
  code: string | null;
  floor: string | null;
  wing: string | null;
  room: string | null;
  kind: string;
  brand: string | null;
  model: string | null;
};

export type CachedDeviceDetails = CachedDeviceListItem & {
  locationDescription: string | null;
  additionalInfo: string | null;
  serialNumber: string | null;
  sourceDeviceCode: string | null;
  devicePhotoUrl: string | null;
  cachedPhotoBlob: Blob | null;
};

type CachedDevicePhotoRecord = {
  deviceId: string;
  blob: Blob;
  sourceUrl: string;
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
      if (!db.objectStoreNames.contains(DEVICE_PHOTOS_STORE)) {
        db.createObjectStore(DEVICE_PHOTOS_STORE, { keyPath: "deviceId" });
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

const getAllRecords = async <T>(storeName: string): Promise<T[]> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve((request.result as T[] | undefined) ?? []);
  });
};

const fetchPhotoBlob = async (url: string): Promise<Blob> => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("failed to fetch device photo");
  }

  return response.blob();
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
  const existingDevices = await getAllRecords<CachedDevice>(DEVICES_STORE);
  const existingCodesByDeviceId = new Map(
    existingDevices
      .filter((device) => device.code)
      .map((device) => [device.id, device.code ?? null]),
  );
  const photoRecords = (
    await Promise.all(
      payload.devices.map(async (device) => {
        if (!device.device_photo_url) {
          return null;
        }

        try {
          return {
            deviceId: device.id,
            blob: await fetchPhotoBlob(device.device_photo_url),
            sourceUrl: device.device_photo_url,
          } satisfies CachedDevicePhotoRecord;
        } catch {
          return null;
        }
      }),
    )
  ).filter((record): record is CachedDevicePhotoRecord => record !== null);

  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(
      [BUILDINGS_STORE, LOCATIONS_STORE, DEVICES_STORE, DEVICE_PHOTOS_STORE, SETTINGS_STORE],
      "readwrite",
    );

    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();

    tx.objectStore(BUILDINGS_STORE).clear();
    tx.objectStore(LOCATIONS_STORE).clear();
    tx.objectStore(DEVICES_STORE).clear();
    tx.objectStore(DEVICE_PHOTOS_STORE).clear();

    tx.objectStore(BUILDINGS_STORE).put(payload.building);
    payload.locations.forEach((location) => {
      tx.objectStore(LOCATIONS_STORE).put(location);
    });
    payload.devices.forEach((device) => {
      tx.objectStore(DEVICES_STORE).put({
        ...device,
        code: existingCodesByDeviceId.get(device.id) ?? null,
      } satisfies CachedDevice);
    });
    photoRecords.forEach((record) => {
      tx.objectStore(DEVICE_PHOTOS_STORE).put(record);
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

export const getCachedDeviceListItems = async (): Promise<CachedDeviceListItem[]> => {
  const [locations, devices] = await Promise.all([
    getAllRecords<CachedLocation>(LOCATIONS_STORE),
    getAllRecords<CachedDevice>(DEVICES_STORE),
  ]);

  const locationById = new Map(locations.map((location) => [location.id, location]));

  return devices.map((device) => {
    const location = device.location_id ? locationById.get(device.location_id) : null;

    return {
      id: device.id,
      code: device.code ?? null,
      floor: location?.floor ?? null,
      wing: location?.wing ?? null,
      room: location?.room ?? null,
      kind: device.kind,
      brand: device.brand,
      model: device.model,
    };
  });
};

export const getCachedDeviceDetails = async (
  deviceId: string,
): Promise<CachedDeviceDetails | null> => {
  const [locations, device, cachedPhoto] = await Promise.all([
    getAllRecords<CachedLocation>(LOCATIONS_STORE),
    getRecord<CachedDevice>(DEVICES_STORE, deviceId),
    getRecord<CachedDevicePhotoRecord>(DEVICE_PHOTOS_STORE, deviceId),
  ]);

  if (!device) {
    return null;
  }

  const location = device.location_id
    ? locations.find((candidate) => candidate.id === device.location_id) ?? null
    : null;

  return {
    id: device.id,
    code: device.code ?? null,
    floor: location?.floor ?? null,
    wing: location?.wing ?? null,
    room: location?.room ?? null,
    kind: device.kind,
    brand: device.brand,
    model: device.model,
    locationDescription: location?.location_description ?? null,
    additionalInfo: device.additional_info ?? null,
    serialNumber: device.serial_number ?? null,
    sourceDeviceCode: device.source_device_code ?? null,
    devicePhotoUrl: device.device_photo_url ?? null,
    cachedPhotoBlob: cachedPhoto?.blob ?? null,
  };
};

export const assignCachedDeviceBarcode = async (deviceId: string, code: string): Promise<void> => {
  const db = await openDb();
  const normalizedCode = code.trim();

  if (!normalizedCode) {
    throw new Error("barcode is empty");
  }

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DEVICES_STORE, "readwrite");
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();

    const store = tx.objectStore(DEVICES_STORE);
    const request = store.get(deviceId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const device = request.result as CachedDevice | undefined;
      if (!device) {
        reject(new Error("device not found"));
        return;
      }

      store.put({
        ...device,
        code: normalizedCode,
      } satisfies CachedDevice);
    };
  });
};

export const replaceCachedDevicePhoto = async (deviceId: string): Promise<void> => {
  const db = await openDb();
  const sourceUrl = `https://picsum.photos/seed/${Date.now()}/600/400`;
  const blob = await fetchPhotoBlob(sourceUrl);

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([DEVICES_STORE, DEVICE_PHOTOS_STORE], "readwrite");
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();

    const devicesStore = tx.objectStore(DEVICES_STORE);
    const deviceRequest = devicesStore.get(deviceId);

    deviceRequest.onerror = () => reject(deviceRequest.error);
    deviceRequest.onsuccess = () => {
      const device = deviceRequest.result as CachedDevice | undefined;
      if (!device) {
        reject(new Error("device not found"));
        return;
      }

      devicesStore.put({
        ...device,
        device_photo_url: sourceUrl,
      });

      tx.objectStore(DEVICE_PHOTOS_STORE).put({
        deviceId,
        blob,
        sourceUrl,
      } satisfies CachedDevicePhotoRecord);
    };
  });
};

export const deleteCachedDevicePhoto = async (deviceId: string): Promise<void> => {
  const db = await openDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([DEVICES_STORE, DEVICE_PHOTOS_STORE], "readwrite");
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();

    const devicesStore = tx.objectStore(DEVICES_STORE);
    const deviceRequest = devicesStore.get(deviceId);

    deviceRequest.onerror = () => reject(deviceRequest.error);
    deviceRequest.onsuccess = () => {
      const device = deviceRequest.result as CachedDevice | undefined;
      if (!device) {
        reject(new Error("device not found"));
        return;
      }

      devicesStore.put({
        ...device,
        device_photo_url: null,
      });
      tx.objectStore(DEVICE_PHOTOS_STORE).delete(deviceId);
    };
  });
};
