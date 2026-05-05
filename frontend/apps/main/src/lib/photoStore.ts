import type { MaintenancePhoto } from "@/types/maintenance";

const DB_NAME = "noma-maintenance";
const DB_VERSION = 1;
const STORE_NAME = "photos";

type BlobStoredPhoto = {
  id: string;
  blob: Blob;
  thumbnailBlob?: Blob;
  description: string;
  timestamp: string;
};

type LegacyStoredPhoto = {
  id: string;
  url: string;
  description: string;
  timestamp: string;
};

type StoredPhoto = BlobStoredPhoto | LegacyStoredPhoto;

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

const dataUrlToBlob = (dataUrl: string): Blob | null => {
  const commaIndex = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || commaIndex === -1) {
    return null;
  }

  const header = dataUrl.slice(5, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);
  const parts = header.split(";").filter(Boolean);
  const mimeType = parts[0] || "application/octet-stream";
  const isBase64 = parts.includes("base64");

  try {
    if (isBase64) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new Blob([bytes], { type: mimeType });
    }

    return new Blob([decodeURIComponent(payload)], { type: mimeType });
  } catch {
    return null;
  }
};

const loadImage = (objectUrl: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Nem sikerült betölteni a képet."));
    image.src = objectUrl;
  });

export const createMaintenancePhotoThumbnail = async (
  blob: Blob,
  maxSize = 320,
): Promise<Blob> => {
  if (typeof document === "undefined") {
    return blob;
  }

  const sourceUrl = URL.createObjectURL(blob);
  try {
    const image = await loadImage(sourceUrl);
    const scale = Math.min(maxSize / image.width, maxSize / image.height, 1);
    if (!Number.isFinite(scale) || scale >= 1) {
      return blob;
    }

    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      return blob;
    }

    context.drawImage(image, 0, 0, width, height);

    return await new Promise<Blob>((resolve) => {
      canvas.toBlob((thumbnailBlob) => resolve(thumbnailBlob ?? blob), "image/jpeg", 0.82);
    });
  } catch {
    return blob;
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
};

const putRecord = async (photo: BlobStoredPhoto) =>
  withStore<void>("readwrite", (store) => {
    store.put(photo);
  });

const hydrateLegacyPhoto = async (
  record: LegacyStoredPhoto,
  variant: "full" | "thumbnail",
): Promise<MaintenancePhoto | null> => {
  const blob = dataUrlToBlob(record.url);
  if (!blob) {
    return {
      id: record.id,
      url: record.url,
      description: record.description,
      timestamp: new Date(record.timestamp),
    };
  }

  const timestamp = new Date(record.timestamp);
  if (variant === "full") {
    await putRecord({
      id: record.id,
      blob,
      description: record.description,
      timestamp: record.timestamp,
    });
    return {
      id: record.id,
      url: URL.createObjectURL(blob),
      description: record.description,
      timestamp,
    };
  }

  const thumbnailBlob = await createMaintenancePhotoThumbnail(blob);
  await putRecord({
    id: record.id,
    blob,
    thumbnailBlob,
    description: record.description,
    timestamp: record.timestamp,
  });
  return {
    id: record.id,
    url: URL.createObjectURL(thumbnailBlob),
    description: record.description,
    timestamp,
  };
};

const hydrateBlobPhoto = async (
  record: BlobStoredPhoto,
  variant: "full" | "thumbnail",
): Promise<MaintenancePhoto> => {
  if (variant === "full") {
    return {
      id: record.id,
      url: URL.createObjectURL(record.blob),
      description: record.description,
      timestamp: new Date(record.timestamp),
    };
  }

  const thumbnailBlob = record.thumbnailBlob ?? (await createMaintenancePhotoThumbnail(record.blob));
  if (!record.thumbnailBlob) {
    void putRecord({
      id: record.id,
      blob: record.blob,
      thumbnailBlob,
      description: record.description,
      timestamp: record.timestamp,
    }).catch(() => {
      // Ignore cache refresh failures.
    });
  }

  return {
    id: record.id,
    url: URL.createObjectURL(thumbnailBlob),
    description: record.description,
    timestamp: new Date(record.timestamp),
  };
};

const hydratePhoto = async (
  record: StoredPhoto,
  variant: "full" | "thumbnail",
): Promise<MaintenancePhoto | null> => {
  if ("blob" in record) {
    return hydrateBlobPhoto(record, variant);
  }

  return hydrateLegacyPhoto(record, variant);
};

export const getPhotoById = async (id: string): Promise<MaintenancePhoto | null> => {
  const record = await getRecord(id);
  return record ? hydratePhoto(record, "full") : null;
};

export const getPhotosByIds = async (ids: string[]) => {
  const results = await Promise.all(
    ids.map(async (id) => {
      const record = await getRecord(id);
      return record ? hydratePhoto(record, "thumbnail") : null;
    }),
  );
  return results.filter((photo): photo is MaintenancePhoto => Boolean(photo));
};

export const savePhoto = async (photo: MaintenancePhoto, blob: Blob, thumbnailBlob?: Blob) => {
  await putRecord({
    id: photo.id,
    blob,
    thumbnailBlob: thumbnailBlob ?? blob,
    description: photo.description,
    timestamp: photo.timestamp.toISOString(),
  });
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
