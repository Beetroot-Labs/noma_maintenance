// Dev-only hooks for Playwright e2e tests. Gated by VITE_E2E=true at build time so
// production bundles never include this file's body.
//
// Tests reach into IndexedDB via `window.__noma_e2e.getOutboxItems()` etc. Keeping the
// internal store names confined to this single file means tests never need to know which
// database / store holds what — if those names change, only this file updates.

import {
  getCachedBuildingSnapshot as sharedGetCachedBuildingSnapshot,
  type SharedBuildingCachePayload,
} from "@noma/shared";
import { loadMaintenanceState } from "./maintenanceStore";

const MAINTENANCE_STATE_DB = "noma-maintenance-state";
const MAINTENANCE_STATE_DB_VERSION = 2;
const SYNC_OUTBOX_STORE = "sync_outbox";
const PHOTO_DB = "noma-maintenance";

const openStateDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(MAINTENANCE_STATE_DB, MAINTENANCE_STATE_DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });

const getOutboxItems = async (): Promise<unknown[]> => {
  const db = await openStateDb();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(SYNC_OUTBOX_STORE)) {
      resolve([]);
      return;
    }
    const tx = db.transaction(SYNC_OUTBOX_STORE, "readonly");
    tx.onerror = () => reject(tx.error);
    const request = tx.objectStore(SYNC_OUTBOX_STORE).getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result ?? []);
  });
};

type OutboxStatusOnly = { status?: string; retryable?: boolean };

const hasPendingOutboxItems = async (): Promise<boolean> => {
  const items = (await getOutboxItems()) as OutboxStatusOnly[];
  return items.some(
    (item) =>
      item.status === "PENDING" ||
      item.status === "IN_PROGRESS" ||
      (item.status === "FAILED" && item.retryable === true),
  );
};

const deleteDatabase = (name: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
    request.onsuccess = () => resolve();
  });

const clearAllStorage = async (): Promise<void> => {
  await Promise.all([
    deleteDatabase(MAINTENANCE_STATE_DB),
    deleteDatabase(PHOTO_DB),
  ]);
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    // Storage access can throw in third-party contexts; tests don't care.
  }
};

const getCachedBuildingSnapshot = (
  tenantId: string,
  buildingId: string,
): Promise<SharedBuildingCachePayload | null> =>
  sharedGetCachedBuildingSnapshot(tenantId, buildingId);

const getMaintenanceState = (
  tenantId: string,
  userId: string,
): Promise<unknown | null> => loadMaintenanceState(tenantId, userId);

export const installE2EHooks = () => {
  window.__noma_e2e = {
    getOutboxItems,
    hasPendingOutboxItems,
    clearAllStorage,
    getCachedBuildingSnapshot,
    getMaintenanceState,
  };
};
