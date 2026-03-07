const DB_NAME = "noma-maintenance-state";
const DB_VERSION = 1;
const STORE_NAME = "maintenance_state";

type MaintenanceStateRecord = {
  id: string;
  tenant_id: string;
  user_id: string;
  updated_at: string;
  payload: unknown;
};

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });

const getKey = (tenantId: string, userId: string) => `${tenantId}:${userId}`;

export const loadMaintenanceState = async (
  tenantId: string,
  userId: string,
): Promise<unknown | null> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    tx.onerror = () => reject(tx.error);
    const request = tx.objectStore(STORE_NAME).get(getKey(tenantId, userId));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const record = request.result as MaintenanceStateRecord | undefined;
      resolve(record?.payload ?? null);
    };
  });
};

export const saveMaintenanceState = async (
  tenantId: string,
  userId: string,
  payload: unknown,
): Promise<void> => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();
    tx.objectStore(STORE_NAME).put({
      id: getKey(tenantId, userId),
      tenant_id: tenantId,
      user_id: userId,
      updated_at: new Date().toISOString(),
      payload,
    } satisfies MaintenanceStateRecord);
  });
};

export const clearMaintenanceState = async (
  tenantId: string,
  userId: string,
): Promise<void> => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();
    tx.objectStore(STORE_NAME).delete(getKey(tenantId, userId));
  });
};
