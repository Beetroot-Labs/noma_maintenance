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

const putRecord = async (photo: StoredPhoto) =>
  withStore<void>("readwrite", (store) => {
    store.put(photo);
  });

const fetchAsDataUrl = async (url: string): Promise<string> => {
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
};

const demoPhotoEntries = [
  { id: "photo-demo-1000011602", file: "1000011602.jpg", description: "Karbantartási fotó" },
  { id: "photo-demo-1000011603", file: "1000011603.jpg", description: "Karbantartási fotó" },
  { id: "photo-demo-1000011604", file: "1000011604.jpg", description: "Karbantartási fotó" },
  { id: "photo-demo-1000011605", file: "1000011605.webp", description: "Karbantartási fotó" },
  { id: "photo-demo-1000011606", file: "1000011606.jpg", description: "Karbantartási fotó" },
  { id: "photo-demo-1000011607", file: "1000011607.jpg", description: "Karbantartási fotó" },
  { id: "photo-demo-1000011608", file: "1000011608.jpg", description: "Karbantartási fotó" },
  { id: "photo-demo-fan-01", file: "fan01.jpg", description: "Ventilátor" },
  { id: "photo-demo-fan-02", file: "fan02.jpg", description: "Ventilátor" },
  { id: "photo-demo-indoor-01", file: "indoor01.jpg", description: "Beltéri egység" },
];

export const demoPhotoIds = demoPhotoEntries.map((entry) => entry.id);

export const seedDemoPhotos = async () => {
  const base = `${import.meta.env.BASE_URL}demo-photos/`;

  for (const entry of demoPhotoEntries) {
    const existing = await getRecord(entry.id);
    if (existing) continue;
    const url = await fetchAsDataUrl(`${base}${entry.file}`);
    await putRecord({
      id: entry.id,
      url,
      description: entry.description,
      timestamp: new Date(),
    });
  }
};

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
