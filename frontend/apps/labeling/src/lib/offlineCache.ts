import {
  createSyncRunner,
  isRetryableHttpStatus,
  runOutboxSyncEngine,
  summarizeOutboxItems,
  type OfflineOutboxItem,
  type OfflineSyncStatusSummary,
  type OutboxSyncItemResult,
} from "@noma/shared";

const DB_NAME = "noma-labeling";
const DB_VERSION = 5;
const BUILDINGS_STORE = "buildings";
const LOCATIONS_STORE = "locations";
const DEVICES_STORE = "devices";
const DEVICE_PHOTOS_STORE = "device_photos";
const SYNC_OUTBOX_STORE = "sync_outbox";
const SETTINGS_STORE = "settings";

export type DeviceCodeSyncState = "SYNCED" | "PENDING" | "FAILED";
export type DevicePhotoSyncState = "SYNCED" | "PENDING" | "FAILED";

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
  photo_sync_state?: DevicePhotoSyncState;
  photo_sync_error?: string | null;
  photo_updated_at?: string | null;
  kind: string;
  additional_info: string | null;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  source_device_code: string | null;
  device_photo_url: string | null;
  original_kind: string | null;
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
  locationDescription: string | null;
  kind: string;
  originalKind: string | null;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
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

export type EditableDeviceDetails = {
  floor: string | null;
  wing: string | null;
  room: string | null;
  locationDescription: string | null;
  kind: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  sourceDeviceCode: string | null;
  additionalInfo: string | null;
};

type SyncMutationType =
  | "ASSIGN_DEVICE_BARCODE"
  | "UPSERT_DEVICE_PHOTO"
  | "DELETE_DEVICE_PHOTO"
  | "UPSERT_DEVICE_DETAILS";

type SyncOutboxPayload = {
  barcode?: string;
  contentType?: string | null;
  sourceUrl?: string | null;
  details?: EditableDeviceDetails;
};

type SyncOutboxRecord = OfflineOutboxItem<SyncOutboxPayload> & {
  id: string;
  mutation_id?: string;
  mutation_type: SyncMutationType;
  entity_type: "DEVICE_BARCODE" | "DEVICE_PHOTO" | "DEVICE_DETAILS";
  entity_id: string;
  // Legacy compatibility for already-cached local data.
  operation?: "ASSIGN_BARCODE" | "UPSERT_PHOTO" | "DELETE_PHOTO";
  payload?: SyncOutboxPayload;
};

type CachedDevicePhotoRecord = {
  deviceId: string;
  blob: Blob;
  sourceUrl: string;
  contentType: string | null;
};

export type SyncStatusSummary = {
  hasRetryableChanges: boolean;
  hasSyncErrors: boolean;
  pendingCount: number;
  inProgressCount: number;
  failedCount: number;
  retryableCount: number;
};

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      const tx = request.transaction;
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
      if (request.oldVersion < 5 && tx && db.objectStoreNames.contains(SYNC_OUTBOX_STORE)) {
        // Clear legacy outbox rows so every queued mutation follows the unified format.
        tx.objectStore(SYNC_OUTBOX_STORE).clear();
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
  const response = await fetch(url, { cache: "no-store", credentials: "include" });
  if (!response.ok) {
    throw new Error("failed to fetch device photo");
  }

  return response.blob();
};

const barcodeOutboxId = (deviceId: string) => `DEVICE_BARCODE:${deviceId}`;
const photoOutboxId = (deviceId: string) => `DEVICE_PHOTO:${deviceId}`;
const detailsOutboxId = (deviceId: string) => `DEVICE_DETAILS:${deviceId}`;

const normalizeMutationType = (item: SyncOutboxRecord): SyncMutationType => {
  if (item.mutation_type) {
    return item.mutation_type;
  }
  if (item.operation === "UPSERT_PHOTO") {
    return "UPSERT_DEVICE_PHOTO";
  }
  if (item.operation === "DELETE_PHOTO") {
    return "DELETE_DEVICE_PHOTO";
  }
  if (item.entity_type === "DEVICE_DETAILS") {
    return "UPSERT_DEVICE_DETAILS";
  }
  return "ASSIGN_DEVICE_BARCODE";
};

const getItemPayload = (item: SyncOutboxRecord): SyncOutboxPayload =>
  item.payload_json ?? item.payload ?? {};

const isPendingSyncItem = (item: Pick<SyncOutboxRecord, "status" | "retryable">) =>
  item.status === "PENDING" ||
  item.status === "IN_PROGRESS" ||
  (item.status === "FAILED" && item.retryable);

const mutationIdForItem = (item: SyncOutboxRecord) => item.mutation_id ?? item.id;

const createMutationId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const normalizeNullableText = (value: string | null | undefined): string | null => {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const toEditableDetails = (
  device: CachedDevice,
  location: CachedLocation | null,
): EditableDeviceDetails => ({
  floor: location?.floor ?? null,
  wing: location?.wing ?? null,
  room: location?.room ?? null,
  locationDescription: location?.location_description ?? null,
  kind: device.kind,
  brand: device.brand ?? null,
  model: device.model ?? null,
  serialNumber: device.serial_number ?? null,
  sourceDeviceCode: device.source_device_code ?? null,
  additionalInfo: device.additional_info ?? null,
});

const readSyncError = async (
  response: Response,
): Promise<{ message: string; retryable: boolean | null }> => {
  const defaultMessage = "Sikertelen szinkronizáció.";
  const defaultRetryable = isRetryableHttpStatus(response.status);
  try {
    const payload = (await response.json()) as {
      error?: string;
      retryable?: boolean;
    };
    return {
      message: payload.error ?? defaultMessage,
      retryable: typeof payload.retryable === "boolean" ? payload.retryable : null,
    };
  } catch {
    return {
      message: defaultMessage,
      retryable: null,
    };
  }
};

const syncRunner = createSyncRunner({
  runSync: async () => {
    await syncPendingBarcodeAssignments();
  },
  baseIntervalMs: 60_000,
  maxIntervalMs: 5 * 60_000,
});

export const startOfflineSyncRunner = () => {
  syncRunner.start();
};

export const stopOfflineSyncRunner = () => {
  syncRunner.stop();
};

export const triggerOfflineSyncNow = () => {
  syncRunner.triggerNow();
};

export const hasOfflineCache = async (): Promise<boolean> => {
  const [buildingCount, deviceCount] = await Promise.all([
    countStore(BUILDINGS_STORE),
    countStore(DEVICES_STORE),
  ]);
  return buildingCount > 0 && deviceCount > 0;
};

export const getPendingSyncChangesCount = async (): Promise<number> => {
  const items = await getAllRecords<SyncOutboxRecord>(SYNC_OUTBOX_STORE);
  const summary = summarizeOutboxItems(items);
  return summary.retryableCount;
};

export const getSyncStatusSummary = async (): Promise<SyncStatusSummary> => {
  const items = await getAllRecords<SyncOutboxRecord>(SYNC_OUTBOX_STORE);
  const summary: OfflineSyncStatusSummary = summarizeOutboxItems(items);
  return {
    hasRetryableChanges: summary.hasRetryableChanges,
    hasSyncErrors: summary.hasSyncErrors,
    pendingCount: summary.pendingCount,
    inProgressCount: summary.inProgressCount,
    failedCount: summary.failedCount,
    retryableCount: summary.retryableCount,
  };
};

export const clearPendingSyncChanges = async (): Promise<void> => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SYNC_OUTBOX_STORE, "readwrite");
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();
    tx.objectStore(SYNC_OUTBOX_STORE).clear();
  });
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
          isPendingSyncItem(item),
      )
      .map((item) => item.entity_id),
  );
  const pendingPhotoDeviceIds = new Set(
    pendingBarcodeOutbox
      .filter((item) => item.entity_type === "DEVICE_PHOTO")
      .map((item) => item.entity_id),
  );
  const pendingDetailsDeviceIds = new Set(
    pendingBarcodeOutbox
      .filter(
        (item) =>
          item.entity_type === "DEVICE_DETAILS" &&
          isPendingSyncItem(item),
      )
      .map((item) => item.entity_id),
  );
  const pendingDetailsLocationById = new Map<string, CachedLocation>();
  const existingLocations = await getAllRecords<CachedLocation>(LOCATIONS_STORE);
  const existingLocationById = new Map(existingLocations.map((location) => [location.id, location]));
  existingDevices.forEach((device) => {
    if (!pendingDetailsDeviceIds.has(device.id) || !device.location_id) {
      return;
    }
    const location = existingLocationById.get(device.location_id);
    if (location) {
      pendingDetailsLocationById.set(location.id, location);
    }
  });
  // Server-side photos are no longer pre-downloaded during cache — they load
  // on demand in the device details view and are cached by the browser.
  // Only preserve existing blobs for devices with a locally pending photo upload.
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
    // Only clear server-fetched photos; keep locally pending uploads.
    if (pendingPhotoDeviceIds.size === 0) {
      tx.objectStore(DEVICE_PHOTOS_STORE).clear();
    }

    tx.objectStore(BUILDINGS_STORE).put(payload.building);
    payload.locations.forEach((location) => {
      const nextLocation = pendingDetailsLocationById.get(location.id) ?? location;
      tx.objectStore(LOCATIONS_STORE).put(nextLocation);
    });
    payload.devices.forEach((device) => {
      const existingDevice = existingDeviceById.get(device.id);
      const preserveLocalBarcode = pendingBarcodeDeviceIds.has(device.id);
      const preserveLocalPhoto = pendingPhotoDeviceIds.has(device.id);
      const preserveLocalDetails = pendingDetailsDeviceIds.has(device.id);
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
      const nextPhotoUrl = preserveLocalPhoto
        ? existingDevice?.device_photo_url ?? null
        : device.device_photo_url ?? null;
      const nextPhotoSyncState = preserveLocalPhoto
        ? existingDevice?.photo_sync_state ?? "PENDING"
        : "SYNCED";
      const nextPhotoSyncError = preserveLocalPhoto
        ? existingDevice?.photo_sync_error ?? null
        : null;
      const nextPhotoUpdatedAt = preserveLocalPhoto
        ? existingDevice?.photo_updated_at ?? null
        : existingDevice?.device_photo_url !== device.device_photo_url
          ? new Date().toISOString()
          : existingDevice?.photo_updated_at ?? null;

      tx.objectStore(DEVICES_STORE).put({
        ...device,
        kind: preserveLocalDetails ? existingDevice?.kind ?? device.kind : device.kind,
        additional_info: preserveLocalDetails
          ? existingDevice?.additional_info ?? device.additional_info
          : device.additional_info,
        brand: preserveLocalDetails ? existingDevice?.brand ?? device.brand : device.brand,
        model: preserveLocalDetails ? existingDevice?.model ?? device.model : device.model,
        serial_number: preserveLocalDetails
          ? existingDevice?.serial_number ?? device.serial_number
          : device.serial_number,
        source_device_code: preserveLocalDetails
          ? existingDevice?.source_device_code ?? device.source_device_code
          : device.source_device_code,
        code: nextCode,
        code_sync_state: nextSyncState,
        code_sync_error: nextSyncError,
        code_updated_at: nextCodeUpdatedAt,
        device_photo_url: nextPhotoUrl,
        photo_sync_state: nextPhotoSyncState,
        photo_sync_error: nextPhotoSyncError,
        photo_updated_at: nextPhotoUpdatedAt,
      } satisfies CachedDevice);
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
      locationDescription: location?.location_description ?? null,
      kind: device.kind,
      originalKind: device.original_kind ?? null,
      brand: device.brand,
      model: device.model,
      serialNumber: device.serial_number ?? null,
    };
  });
};

export const getCachedDeviceDetails = async (
  deviceId: string,
): Promise<CachedDeviceDetails | null> => {
  const [locations, device, cachedPhoto] = await Promise.all([
    getAllRecords<CachedLocation>(LOCATIONS_STORE),
    getRecord<CachedDevice>(DEVICES_STORE, deviceId),
    // Only check DEVICE_PHOTOS_STORE for locally pending user-uploaded photos.
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

export const updateCachedDeviceDetails = async (
  deviceId: string,
  updates: Partial<EditableDeviceDetails>,
): Promise<void> => {
  const db = await openDb();
  const now = new Date().toISOString();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([DEVICES_STORE, LOCATIONS_STORE, SYNC_OUTBOX_STORE], "readwrite");
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();

    const devicesStore = tx.objectStore(DEVICES_STORE);
    const locationsStore = tx.objectStore(LOCATIONS_STORE);
    const outboxStore = tx.objectStore(SYNC_OUTBOX_STORE);
    const deviceRequest = devicesStore.get(deviceId);

    deviceRequest.onerror = () => reject(deviceRequest.error);
    deviceRequest.onsuccess = () => {
      const device = deviceRequest.result as CachedDevice | undefined;
      if (!device) {
        reject(new Error("device not found"));
        return;
      }

      const nextDevice: CachedDevice = {
        ...device,
        kind: updates.kind ?? device.kind,
        brand: updates.brand !== undefined ? normalizeNullableText(updates.brand) : device.brand,
        model: updates.model !== undefined ? normalizeNullableText(updates.model) : device.model,
        serial_number:
          updates.serialNumber !== undefined
            ? normalizeNullableText(updates.serialNumber)
            : device.serial_number,
        source_device_code:
          updates.sourceDeviceCode !== undefined
            ? normalizeNullableText(updates.sourceDeviceCode)
            : device.source_device_code,
        additional_info:
          updates.additionalInfo !== undefined
            ? normalizeNullableText(updates.additionalInfo)
            : device.additional_info,
      };
      devicesStore.put(nextDevice);

      const applyOutboxWithLocation = (nextLocation: CachedLocation | null) => {
        const snapshot = toEditableDetails(nextDevice, nextLocation);
        outboxStore.put({
          id: detailsOutboxId(deviceId),
          mutation_id: createMutationId(),
          mutation_type: "UPSERT_DEVICE_DETAILS",
          entity_type: "DEVICE_DETAILS",
          entity_id: deviceId,
          payload_json: { details: snapshot },
          status: "PENDING",
          retryable: true,
          created_at: now,
          updated_at: now,
          last_attempt_at: null,
          attempt_count: 0,
          last_error: null,
        } satisfies SyncOutboxRecord);
      };

      if (!device.location_id) {
        applyOutboxWithLocation(null);
        return;
      }

      const locationRequest = locationsStore.get(device.location_id);
      locationRequest.onerror = () => reject(locationRequest.error);
      locationRequest.onsuccess = () => {
        const location = locationRequest.result as CachedLocation | undefined;
        const nextLocation = location
          ? ({
              ...location,
              floor:
                updates.floor !== undefined
                  ? normalizeNullableText(updates.floor)
                  : location.floor,
              wing:
                updates.wing !== undefined
                  ? normalizeNullableText(updates.wing)
                  : location.wing,
              room:
                updates.room !== undefined
                  ? normalizeNullableText(updates.room)
                  : location.room,
              location_description:
                updates.locationDescription !== undefined
                  ? normalizeNullableText(updates.locationDescription)
                  : location.location_description,
            } satisfies CachedLocation)
          : null;

        if (nextLocation) {
          locationsStore.put(nextLocation);
        }

        applyOutboxWithLocation(nextLocation);
      };
    };
  });

  triggerOfflineSyncNow();
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
        mutation_id: createMutationId(),
        mutation_type: "ASSIGN_DEVICE_BARCODE",
        entity_type: "DEVICE_BARCODE",
        entity_id: deviceId,
        payload_json: { barcode: normalizedCode },
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

  triggerOfflineSyncNow();
};

export const syncPendingBarcodeAssignments = async (): Promise<void> => {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return;
  }

  const db = await openDb();
  await runOutboxSyncEngine<SyncOutboxRecord>({
    listPendingItems: async () => {
      const items = await getAllRecords<SyncOutboxRecord>(SYNC_OUTBOX_STORE);
      return items.filter((item) => isPendingSyncItem(item));
    },
    prepareAttempt: async (item, attemptAt) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction([DEVICES_STORE, SYNC_OUTBOX_STORE], "readwrite");
        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => resolve("proceed");

        const devicesStore = tx.objectStore(DEVICES_STORE);
        const outboxStore = tx.objectStore(SYNC_OUTBOX_STORE);
        const deviceRequest = devicesStore.get(item.entity_id);
        deviceRequest.onerror = () => reject(deviceRequest.error);
        deviceRequest.onsuccess = () => {
          const device = deviceRequest.result as CachedDevice | undefined;
          if (!device) {
            outboxStore.delete(item.id);
            resolve("skip");
            return;
          }

          if (item.entity_type === "DEVICE_BARCODE" || item.entity_type === "DEVICE_PHOTO") {
            devicesStore.put({
              ...device,
              ...(item.entity_type === "DEVICE_BARCODE"
                ? {
                    code_sync_state: "PENDING" as const,
                    code_sync_error: null,
                  }
                : {
                    photo_sync_state: "PENDING" as const,
                    photo_sync_error: null,
                  }),
            } satisfies CachedDevice);
          }

          outboxStore.put({
            ...item,
            status: "IN_PROGRESS",
            updated_at: attemptAt,
            last_attempt_at: attemptAt,
            attempt_count: item.attempt_count + 1,
            last_error: null,
          } satisfies SyncOutboxRecord);
        };
      }),
    runItem: async (item): Promise<OutboxSyncItemResult> => {
      let response: Response;

      try {
        if (item.entity_type === "DEVICE_BARCODE") {
          const payload = getItemPayload(item);
          response = await fetch(`/api/labeling/devices/${item.entity_id}/barcode`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Mutation-Id": mutationIdForItem(item),
            },
            credentials: "include",
            body: JSON.stringify({ code: payload.barcode }),
          });
        } else if (item.entity_type === "DEVICE_DETAILS") {
          response = await fetch(`/api/labeling/devices/${item.entity_id}/details`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              "X-Mutation-Id": mutationIdForItem(item),
            },
            credentials: "include",
            body: JSON.stringify(getItemPayload(item).details ?? {}),
          });
        } else if (normalizeMutationType(item) === "UPSERT_DEVICE_PHOTO") {
          const photoRecord = await getRecord<CachedDevicePhotoRecord>(DEVICE_PHOTOS_STORE, item.entity_id);
          if (!photoRecord) {
            await new Promise<void>((resolve, reject) => {
              const tx = db.transaction(SYNC_OUTBOX_STORE, "readwrite");
              tx.onerror = () => reject(tx.error);
              tx.oncomplete = () => resolve();
              tx.objectStore(SYNC_OUTBOX_STORE).delete(item.id);
            });
            return { status: "skip" };
          }

          response = await fetch(`/api/labeling/devices/${item.entity_id}/photo`, {
            method: "PUT",
            headers: {
              "Content-Type": photoRecord.contentType ?? "application/octet-stream",
              "X-Mutation-Id": mutationIdForItem(item),
            },
            credentials: "include",
            body: photoRecord.blob,
          });
        } else {
          response = await fetch(`/api/labeling/devices/${item.entity_id}/photo`, {
            method: "DELETE",
            headers: {
              "X-Mutation-Id": mutationIdForItem(item),
            },
            credentials: "include",
          });
        }
      } catch {
        return {
          status: "failure",
          errorMessage: "A szerver jelenleg nem érhető el.",
          retryable: true,
        };
      }

      if (!response.ok) {
        const syncError = await readSyncError(response);
        return {
          status: "failure",
          errorMessage: syncError.message,
          retryable:
            syncError.retryable === null
              ? isRetryableHttpStatus(response.status)
              : syncError.retryable,
        };
      }

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([DEVICES_STORE, LOCATIONS_STORE, SYNC_OUTBOX_STORE], "readwrite");
        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => resolve();

        const devicesStore = tx.objectStore(DEVICES_STORE);
        const locationsStore = tx.objectStore(LOCATIONS_STORE);
        const outboxStore = tx.objectStore(SYNC_OUTBOX_STORE);
        const deviceRequest = devicesStore.get(item.entity_id);

        deviceRequest.onerror = () => reject(deviceRequest.error);
        deviceRequest.onsuccess = () => {
          const device = deviceRequest.result as CachedDevice | undefined;
          if (device) {
            const payload = getItemPayload(item);
            const nextPhotoUrl =
              item.entity_type === "DEVICE_PHOTO" &&
              normalizeMutationType(item) === "UPSERT_DEVICE_PHOTO"
                ? `/api/labeling/devices/${item.entity_id}/photo`
                : null;

            if (item.entity_type === "DEVICE_BARCODE") {
              devicesStore.put({
                ...device,
                code: payload.barcode ?? device.code ?? null,
                code_sync_state: "SYNCED" as const,
                code_sync_error: null,
              } satisfies CachedDevice);
            } else if (item.entity_type === "DEVICE_PHOTO") {
              devicesStore.put({
                ...device,
                device_photo_url: nextPhotoUrl,
                photo_sync_state: "SYNCED" as const,
                photo_sync_error: null,
              } satisfies CachedDevice);
            } else if (item.entity_type === "DEVICE_DETAILS") {
              const details = payload.details;
              if (details) {
                devicesStore.put({
                  ...device,
                  kind: details.kind,
                  brand: normalizeNullableText(details.brand),
                  model: normalizeNullableText(details.model),
                  serial_number: normalizeNullableText(details.serialNumber),
                  source_device_code: normalizeNullableText(details.sourceDeviceCode),
                  additional_info: normalizeNullableText(details.additionalInfo),
                } satisfies CachedDevice);
                if (device.location_id) {
                  const locationReq = locationsStore.get(device.location_id);
                  locationReq.onsuccess = () => {
                    const currentLocation = locationReq.result as CachedLocation | undefined;
                    if (!currentLocation) {
                      return;
                    }
                    locationsStore.put({
                      ...currentLocation,
                      floor: normalizeNullableText(details.floor),
                      wing: normalizeNullableText(details.wing),
                      room: normalizeNullableText(details.room),
                      location_description: normalizeNullableText(details.locationDescription),
                    } satisfies CachedLocation);
                  };
                }
              }
            }
          }

          outboxStore.delete(item.id);
        };
      });

      return { status: "success" };
    },
    applyFailure: async (item, failure, attemptAt) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction([DEVICES_STORE, SYNC_OUTBOX_STORE], "readwrite");
        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => resolve();

        const devicesStore = tx.objectStore(DEVICES_STORE);
        const outboxStore = tx.objectStore(SYNC_OUTBOX_STORE);
        const deviceRequest = devicesStore.get(item.entity_id);

        deviceRequest.onerror = () => reject(deviceRequest.error);
        deviceRequest.onsuccess = () => {
          const device = deviceRequest.result as CachedDevice | undefined;
          if (device && (item.entity_type === "DEVICE_BARCODE" || item.entity_type === "DEVICE_PHOTO")) {
            devicesStore.put({
              ...device,
              ...(item.entity_type === "DEVICE_BARCODE"
                ? {
                    code_sync_state: "FAILED" as const,
                    code_sync_error: failure.errorMessage,
                  }
                : {
                    photo_sync_state: "FAILED" as const,
                    photo_sync_error: failure.errorMessage,
                  }),
            } satisfies CachedDevice);
          }

          outboxStore.put({
            ...item,
            status: "FAILED",
            retryable: failure.retryable,
            updated_at: new Date().toISOString(),
            last_attempt_at: attemptAt,
            attempt_count: item.attempt_count + 1,
            last_error: failure.errorMessage,
          } satisfies SyncOutboxRecord);
        };
      }),
  });
};

export const replaceCachedDevicePhoto = async (deviceId: string, file: Blob): Promise<void> => {
  const db = await openDb();
  const now = new Date().toISOString();
  const sourceUrl = `local://device-photo/${deviceId}/${Date.now()}`;
  const blob = file.slice(0, file.size, file.type || "application/octet-stream");

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([DEVICES_STORE, DEVICE_PHOTOS_STORE, SYNC_OUTBOX_STORE], "readwrite");
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
        photo_sync_state: "PENDING",
        photo_sync_error: null,
        photo_updated_at: now,
      });

      tx.objectStore(DEVICE_PHOTOS_STORE).put({
        deviceId,
        blob,
        sourceUrl,
        contentType: blob.type || null,
      } satisfies CachedDevicePhotoRecord);

      tx.objectStore(SYNC_OUTBOX_STORE).put({
        id: photoOutboxId(deviceId),
        mutation_id: createMutationId(),
        mutation_type: "UPSERT_DEVICE_PHOTO",
        entity_type: "DEVICE_PHOTO",
        entity_id: deviceId,
        payload_json: {
          contentType: blob.type || null,
          sourceUrl,
        },
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

  triggerOfflineSyncNow();
};

export const deleteCachedDevicePhoto = async (deviceId: string): Promise<void> => {
  const db = await openDb();
  const now = new Date().toISOString();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([DEVICES_STORE, DEVICE_PHOTOS_STORE, SYNC_OUTBOX_STORE], "readwrite");
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
        photo_sync_state: "PENDING",
        photo_sync_error: null,
        photo_updated_at: now,
      });
      tx.objectStore(DEVICE_PHOTOS_STORE).delete(deviceId);
      tx.objectStore(SYNC_OUTBOX_STORE).put({
        id: photoOutboxId(deviceId),
        mutation_id: createMutationId(),
        mutation_type: "DELETE_DEVICE_PHOTO",
        entity_type: "DEVICE_PHOTO",
        entity_id: deviceId,
        payload_json: {},
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

  triggerOfflineSyncNow();
};
