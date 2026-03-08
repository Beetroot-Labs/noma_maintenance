import type { MaintenancePhoto } from "@/types/maintenance";

const DB_NAME = "noma-maintenance";
const DB_VERSION = 1;
const STORE_NAME = "photos";

type StoredPhoto = MaintenancePhoto;

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

const withStore = async <T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => void,
): Promise<T> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    fn(store);
    tx.oncomplete = () => resolve(undefined as T);
    tx.onerror = () => reject(tx.error);
  });
};

const getRecord = async (id: string): Promise<StoredPhoto | null> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || null);
  });
};

export const getPhotoById = async (id: string): Promise<MaintenancePhoto | null> => {
  return getRecord(id);
};

const putRecord = async (photo: StoredPhoto) =>
  withStore<void>("readwrite", (store) => {
    store.put(photo);
  });

export const getPhotosByIds = async (ids: string[]) => {
  const results = await Promise.all(ids.map((id) => getRecord(id)));
  return results.filter((photo): photo is MaintenancePhoto => Boolean(photo));
};

export const savePhoto = async (photo: MaintenancePhoto) => {
  await putRecord(photo);
};

export const clearPhotos = async () =>
  withStore<void>("readwrite", (store) => {
    store.clear();
  });

export const purgeDemoPhotos = async () => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();
    const store = tx.objectStore(STORE_NAME);
    const request = store.openCursor();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        return;
      }
      const key = String(cursor.primaryKey);
      if (key.startsWith("photo-demo-")) {
        store.delete(cursor.primaryKey);
      }
      cursor.continue();
    };
  });
};
