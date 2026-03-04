const DB_NAME = "noma-labeling";
const DB_VERSION = 3;
const BUILDINGS_STORE = "buildings";
const LOCATIONS_STORE = "locations";
const DEVICES_STORE = "devices";
const DEVICE_PHOTOS_STORE = "device_photos";
const SYNC_OUTBOX_STORE = "sync_outbox";
const SETTINGS_STORE = "settings";

export type DeviceCodeSyncState = "SYNCED" | "PENDING" | "FAILED";

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
  code_sync_state?: DeviceCodeSyncState;
  code_sync_error?: string | null;
  code_updated_at?: string | null;
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
  codeSyncState: DeviceCodeSyncState;
  codeSyncError: string | null;
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
  codeSyncState: DeviceCodeSyncState;
  codeSyncError: string | null;
  serialNumber: string | null;
  sourceDeviceCode: string | null;
  devicePhotoUrl: string | null;
  cachedPhotoBlob: Blob | null;
};

type SyncOutboxRecord = {
  id: string;
  entity_type: "DEVICE_BARCODE";
  entity_id: string;
  operation: "ASSIGN_BARCODE";
  payload: {
    barcode: string;
  };
  status: "PENDING" | "IN_PROGRESS" | "FAILED";
  retryable: boolean;
  created_at: string;
  updated_at: string;
  last_attempt_at: string | null;
  attempt_count: number;
  last_error: string | null;
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
      if (!db.objectStoreNames.contains(SYNC_OUTBOX_STORE)) {
        const outboxStore = db.createObjectStore(SYNC_OUTBOX_STORE, { keyPath: "id" });
        outboxStore.createIndex("status", "status", { unique: false });
        outboxStore.createIndex("updated_at", "updated_at", { unique: false });
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

const barcodeOutboxId = (deviceId: string) => `DEVICE_BARCODE:${deviceId}`;

const readErrorMessage = async (response: Response) => {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // Ignore invalid error payloads.
  }

  return "Sikertelen szinkronizáció.";
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
  const pendingBarcodeOutbox = await getAllRecords<SyncOutboxRecord>(SYNC_OUTBOX_STORE);
  const existingDeviceById = new Map(existingDevices.map((device) => [device.id, device]));
  const pendingBarcodeDeviceIds = new Set(
    pendingBarcodeOutbox
      .filter(
        (item) =>
          item.entity_type === "DEVICE_BARCODE" &&
          (item.status === "PENDING" || item.status === "IN_PROGRESS" || item.retryable),
      )
      .map((item) => item.entity_id),
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
      [
        BUILDINGS_STORE,
        LOCATIONS_STORE,
        DEVICES_STORE,
        DEVICE_PHOTOS_STORE,
        SYNC_OUTBOX_STORE,
        SETTINGS_STORE,
      ],
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
      const existingDevice = existingDeviceById.get(device.id);
      const preserveLocalBarcode = pendingBarcodeDeviceIds.has(device.id);
      const nextCode = preserveLocalBarcode ? existingDevice?.code ?? null : device.code ?? null;
      const nextSyncState = preserveLocalBarcode
        ? existingDevice?.code_sync_state ?? "PENDING"
        : "SYNCED";
      const nextSyncError = preserveLocalBarcode ? existingDevice?.code_sync_error ?? null : null;
      const nextCodeUpdatedAt = preserveLocalBarcode
        ? existingDevice?.code_updated_at ?? null
        : existingDevice?.code !== device.code
          ? new Date().toISOString()
          : existingDevice?.code_updated_at ?? null;

      tx.objectStore(DEVICES_STORE).put({
        ...device,
        code: nextCode,
        code_sync_state: nextSyncState,
        code_sync_error: nextSyncError,
        code_updated_at: nextCodeUpdatedAt,
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
      codeSyncState: device.code_sync_state ?? "SYNCED",
      codeSyncError: device.code_sync_error ?? null,
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
    codeSyncState: device.code_sync_state ?? "SYNCED",
    codeSyncError: device.code_sync_error ?? null,
    serialNumber: device.serial_number ?? null,
    sourceDeviceCode: device.source_device_code ?? null,
    devicePhotoUrl: device.device_photo_url ?? null,
    cachedPhotoBlob: cachedPhoto?.blob ?? null,
  };
};

export const assignCachedDeviceBarcode = async (deviceId: string, code: string): Promise<void> => {
  const db = await openDb();
  const normalizedCode = code.trim();
  const now = new Date().toISOString();

  if (!normalizedCode) {
    throw new Error("barcode is empty");
  }

  const existingDevices = await getAllRecords<CachedDevice>(DEVICES_STORE);
  const conflictingDevice = existingDevices.find(
    (device) => device.id !== deviceId && device.code?.trim() === normalizedCode,
  );

  if (conflictingDevice) {
    throw new Error("Ez a vonalkód már hozzá van rendelve egy másik eszközhöz.");
  }

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([DEVICES_STORE, SYNC_OUTBOX_STORE], "readwrite");
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();

    const devicesStore = tx.objectStore(DEVICES_STORE);
    const outboxStore = tx.objectStore(SYNC_OUTBOX_STORE);
    const request = devicesStore.get(deviceId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const device = request.result as CachedDevice | undefined;
      if (!device) {
        reject(new Error("device not found"));
        return;
      }

      devicesStore.put({
        ...device,
        code: normalizedCode,
        code_sync_state: "PENDING",
        code_sync_error: null,
        code_updated_at: now,
      } satisfies CachedDevice);

      outboxStore.put({
        id: barcodeOutboxId(deviceId),
        entity_type: "DEVICE_BARCODE",
        entity_id: deviceId,
        operation: "ASSIGN_BARCODE",
        payload: { barcode: normalizedCode },
        status: "PENDING",
        retryable: true,
        created_at: now,
        updated_at: now,
        last_attempt_at: null,
        attempt_count: 0,
        last_error: null,
      } satisfies SyncOutboxRecord);
    };
  });
};

export const syncPendingBarcodeAssignments = async (): Promise<void> => {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return;
  }

  const db = await openDb();
  const items = await getAllRecords<SyncOutboxRecord>(SYNC_OUTBOX_STORE);
  const pendingItems = items.filter(
    (item) =>
      item.entity_type === "DEVICE_BARCODE" &&
      (item.status === "PENDING" || item.status === "IN_PROGRESS" || (item.status === "FAILED" && item.retryable)),
  );

  for (const item of pendingItems) {
    const attemptAt = new Date().toISOString();

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([DEVICES_STORE, SYNC_OUTBOX_STORE], "readwrite");
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve();

      const devicesStore = tx.objectStore(DEVICES_STORE);
      const outboxStore = tx.objectStore(SYNC_OUTBOX_STORE);

      const deviceRequest = devicesStore.get(item.entity_id);
      deviceRequest.onerror = () => reject(deviceRequest.error);
      deviceRequest.onsuccess = () => {
        const device = deviceRequest.result as CachedDevice | undefined;
        if (!device) {
          outboxStore.delete(item.id);
          return;
        }

        devicesStore.put({
          ...device,
          code_sync_state: "PENDING",
          code_sync_error: null,
        } satisfies CachedDevice);

        outboxStore.put({
          ...item,
          status: "IN_PROGRESS",
          updated_at: attemptAt,
          last_attempt_at: attemptAt,
          attempt_count: item.attempt_count + 1,
          last_error: null,
        } satisfies SyncOutboxRecord);
      };
    });

    try {
      const response = await fetch(`/api/labeling/devices/${item.entity_id}/barcode`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ code: item.payload.barcode }),
      });

      if (!response.ok) {
        const errorMessage = await readErrorMessage(response);
        const retryable = response.status >= 500 || response.status === 429;

        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction([DEVICES_STORE, SYNC_OUTBOX_STORE], "readwrite");
          tx.onerror = () => reject(tx.error);
          tx.oncomplete = () => resolve();

          const devicesStore = tx.objectStore(DEVICES_STORE);
          const outboxStore = tx.objectStore(SYNC_OUTBOX_STORE);
          const deviceRequest = devicesStore.get(item.entity_id);

          deviceRequest.onerror = () => reject(deviceRequest.error);
          deviceRequest.onsuccess = () => {
            const device = deviceRequest.result as CachedDevice | undefined;
            if (device) {
              devicesStore.put({
                ...device,
                code_sync_state: "FAILED",
                code_sync_error: errorMessage,
              } satisfies CachedDevice);
            }

            outboxStore.put({
              ...item,
              status: "FAILED",
              retryable,
              updated_at: new Date().toISOString(),
              last_attempt_at: attemptAt,
              attempt_count: item.attempt_count + 1,
              last_error: errorMessage,
            } satisfies SyncOutboxRecord);
          };
        });

        continue;
      }

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([DEVICES_STORE, SYNC_OUTBOX_STORE], "readwrite");
        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => resolve();

        const devicesStore = tx.objectStore(DEVICES_STORE);
        const outboxStore = tx.objectStore(SYNC_OUTBOX_STORE);
        const deviceRequest = devicesStore.get(item.entity_id);

        deviceRequest.onerror = () => reject(deviceRequest.error);
        deviceRequest.onsuccess = () => {
          const device = deviceRequest.result as CachedDevice | undefined;
          if (device) {
            devicesStore.put({
              ...device,
              code: item.payload.barcode,
              code_sync_state: "SYNCED",
              code_sync_error: null,
            } satisfies CachedDevice);
          }

          outboxStore.delete(item.id);
        };
      });
    } catch {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([DEVICES_STORE, SYNC_OUTBOX_STORE], "readwrite");
        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => resolve();

        const devicesStore = tx.objectStore(DEVICES_STORE);
        const outboxStore = tx.objectStore(SYNC_OUTBOX_STORE);
        const deviceRequest = devicesStore.get(item.entity_id);

        deviceRequest.onerror = () => reject(deviceRequest.error);
        deviceRequest.onsuccess = () => {
          const device = deviceRequest.result as CachedDevice | undefined;
          if (device) {
            devicesStore.put({
              ...device,
              code_sync_state: "FAILED",
              code_sync_error: "A szerver jelenleg nem érhető el.",
            } satisfies CachedDevice);
          }

          outboxStore.put({
            ...item,
            status: "FAILED",
            retryable: true,
            updated_at: new Date().toISOString(),
            last_attempt_at: attemptAt,
            attempt_count: item.attempt_count + 1,
            last_error: "A szerver jelenleg nem érhető el.",
          } satisfies SyncOutboxRecord);
        };
      });
    }
  }
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
