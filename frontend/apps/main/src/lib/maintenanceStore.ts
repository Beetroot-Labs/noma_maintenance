import {
  createSyncRunner,
  isRetryableHttpStatus,
  runOutboxSyncEngine,
  type OfflineOutboxItem,
  type OutboxSyncItemResult,
} from "@noma/shared";
import { getPhotoById } from "@/lib/photoStore";
import type { MaintenanceWorkSyncState } from "@/types/maintenance";

const DB_NAME = "noma-maintenance-state";
const DB_VERSION = 2;
const STORE_NAME = "maintenance_state";
const SYNC_OUTBOX_STORE = "sync_outbox";

type MaintenanceStateRecord = {
  id: string;
  tenant_id: string;
  user_id: string;
  updated_at: string;
  payload: unknown;
};

type MaintenanceSyncMutationType =
  | "UPSERT_MAINTENANCE_WORK"
  | "UPSERT_MAINTENANCE_PHOTO"
  | "FINALIZE_MAINTENANCE_WORK";

type MaintenanceSyncPayload = {
  work?: QueueMaintenanceWorkSyncInput;
  photo?: QueueMaintenancePhotoSyncInput;
  finalize?: QueueMaintenanceFinalizeSyncInput;
};

type MaintenanceSyncOutboxRecord = OfflineOutboxItem<MaintenanceSyncPayload> & {
  id: string;
  mutation_id: string;
  mutation_type: MaintenanceSyncMutationType;
  entity_type: "MAINTENANCE_WORK" | "MAINTENANCE_PHOTO";
  entity_id: string;
};

export type QueueMaintenanceWorkSyncInput = {
  workId: string;
  shiftId: string;
  deviceId: string;
  status: "IN_PROGRESS" | "FINISHED" | "ABORTED";
  startedAt: string;
  finishedAt: string | null;
  abortedAt: string | null;
  malfunctionDescription: string | null;
  followupServiceRequired: boolean;
  followupServiceReasons: string[];
  followupServiceReasonOther: string | null;
  note: string | null;
};

export type QueueMaintenancePhotoSyncInput = {
  workId: string;
  photoId: string;
  captureNote: string | null;
  capturedAt: string;
  photoType: "MAINTENANCE" | "MALFUNCTION";
};

export type QueueMaintenanceFinalizeSyncInput = {
  work: QueueMaintenanceWorkSyncInput;
  photos: QueueMaintenancePhotoSyncInput[];
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
      if (!db.objectStoreNames.contains(SYNC_OUTBOX_STORE)) {
        const outboxStore = db.createObjectStore(SYNC_OUTBOX_STORE, { keyPath: "id" });
        outboxStore.createIndex("status", "status", { unique: false });
        outboxStore.createIndex("updated_at", "updated_at", { unique: false });
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

const createMutationId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const getAllOutboxRecords = async (): Promise<MaintenanceSyncOutboxRecord[]> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_OUTBOX_STORE, "readonly");
    tx.onerror = () => reject(tx.error);
    const request = tx.objectStore(SYNC_OUTBOX_STORE).getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () =>
      resolve((request.result as MaintenanceSyncOutboxRecord[] | undefined) ?? []);
  });
};

export const pruneNonRetryableMaintenanceSyncItems = async (): Promise<number> => {
  const db = await openDb();
  const items = await getAllOutboxRecords();
  const nonRetryableIds = items
    .filter((item) => item.status === "FAILED" && !item.retryable)
    .map((item) => item.id);

  if (nonRetryableIds.length === 0) {
    return 0;
  }

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SYNC_OUTBOX_STORE, "readwrite");
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();
    const store = tx.objectStore(SYNC_OUTBOX_STORE);
    nonRetryableIds.forEach((id) => store.delete(id));
  });

  return nonRetryableIds.length;
};

const isPendingSyncItem = (item: Pick<MaintenanceSyncOutboxRecord, "status" | "retryable">) =>
  item.status === "PENDING" ||
  item.status === "IN_PROGRESS" ||
  (item.status === "FAILED" && item.retryable);

const getWorkIdForSyncRecord = (item: MaintenanceSyncOutboxRecord): string | null => {
  if (item.mutation_type === "UPSERT_MAINTENANCE_WORK" || item.mutation_type === "FINALIZE_MAINTENANCE_WORK") {
    return item.entity_id;
  }

  return item.payload_json?.photo?.workId ?? null;
};

export const getMaintenanceWorkSyncStateByWork = async (): Promise<
  Record<string, MaintenanceWorkSyncState>
> => {
  const items = await getAllOutboxRecords();
  const syncStateByWorkId = new Map<
    string,
    MaintenanceWorkSyncState & { updatedAt: string }
  >();

  for (const item of items) {
    const workId = getWorkIdForSyncRecord(item);
    if (!workId) {
      continue;
    }

    const nextStatus =
      item.status === "FAILED" && !item.retryable
        ? "error"
        : isPendingSyncItem(item)
          ? "retriable"
          : null;

    if (!nextStatus) {
      continue;
    }

    const existing = syncStateByWorkId.get(workId);
    const shouldReplace =
      !existing ||
      (nextStatus === "error" && existing.status !== "error") ||
      (existing.status === nextStatus && item.updated_at.localeCompare(existing.updatedAt) > 0);

    if (!shouldReplace) {
      continue;
    }

    syncStateByWorkId.set(workId, {
      status: nextStatus,
      lastError: item.last_error,
      updatedAt: item.updated_at,
    });
  }

  return Object.fromEntries(
    Array.from(syncStateByWorkId.entries()).map(([workId, state]) => [
      workId,
      {
        status: state.status,
        lastError: state.lastError,
      } satisfies MaintenanceWorkSyncState,
    ]),
  );
};

export const hasPendingMaintenanceSyncItems = async (): Promise<boolean> => {
  const items = await getAllOutboxRecords();
  return items.some((item) => isPendingSyncItem(item));
};

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
      retryable: defaultRetryable,
    };
  }
};

const putOutboxRecord = async (record: MaintenanceSyncOutboxRecord): Promise<void> => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SYNC_OUTBOX_STORE, "readwrite");
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();
    tx.objectStore(SYNC_OUTBOX_STORE).put(record);
  });
};

const deleteOutboxRecord = async (db: IDBDatabase, id: string): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SYNC_OUTBOX_STORE, "readwrite");
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();
    tx.objectStore(SYNC_OUTBOX_STORE).delete(id);
  });
};

export const enqueueMaintenanceWorkSync = async (
  payload: QueueMaintenanceWorkSyncInput,
): Promise<void> => {
  const now = new Date().toISOString();
  await putOutboxRecord({
    id: `MAINTENANCE_WORK:${payload.workId}`,
    mutation_id: createMutationId(),
    mutation_type: "UPSERT_MAINTENANCE_WORK",
    entity_type: "MAINTENANCE_WORK",
    entity_id: payload.workId,
    payload_json: { work: payload },
    status: "PENDING",
    retryable: true,
    attempt_count: 0,
    last_attempt_at: null,
    last_error: null,
    created_at: now,
    updated_at: now,
  });
};

export const enqueueMaintenancePhotoSync = async (
  payload: QueueMaintenancePhotoSyncInput,
): Promise<void> => {
  const now = new Date().toISOString();
  await putOutboxRecord({
    id: `MAINTENANCE_PHOTO:${payload.photoId}`,
    mutation_id: createMutationId(),
    mutation_type: "UPSERT_MAINTENANCE_PHOTO",
    entity_type: "MAINTENANCE_PHOTO",
    entity_id: payload.photoId,
    payload_json: { photo: payload },
    status: "PENDING",
    retryable: true,
    attempt_count: 0,
    last_attempt_at: null,
    last_error: null,
    created_at: now,
    updated_at: now,
  });
};

export const enqueueMaintenanceFinalizeSync = async (
  payload: QueueMaintenanceFinalizeSyncInput,
): Promise<void> => {
  const now = new Date().toISOString();
  await putOutboxRecord({
    id: `MAINTENANCE_FINALIZE:${payload.work.workId}`,
    mutation_id: createMutationId(),
    mutation_type: "FINALIZE_MAINTENANCE_WORK",
    entity_type: "MAINTENANCE_WORK",
    entity_id: payload.work.workId,
    payload_json: { finalize: payload },
    status: "PENDING",
    retryable: true,
    attempt_count: 0,
    last_attempt_at: null,
    last_error: null,
    created_at: now,
    updated_at: now,
  });
};

export const syncPendingMaintenanceMutations = async (): Promise<void> => {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return;
  }

  const db = await openDb();
  await runOutboxSyncEngine<MaintenanceSyncOutboxRecord>({
    listPendingItems: async () => {
      const items = await getAllOutboxRecords();
      return items
        .filter((item) => isPendingSyncItem(item))
        .sort((left, right) => left.created_at.localeCompare(right.created_at));
    },
    prepareAttempt: async (item, attemptAt) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(SYNC_OUTBOX_STORE, "readwrite");
        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => resolve("proceed");
        tx.objectStore(SYNC_OUTBOX_STORE).put({
          ...item,
          status: "IN_PROGRESS",
          updated_at: attemptAt,
          last_attempt_at: attemptAt,
          attempt_count: item.attempt_count + 1,
          last_error: null,
        } satisfies MaintenanceSyncOutboxRecord);
      }),
    runItem: async (item): Promise<OutboxSyncItemResult> => {
      let response: Response;

      try {
        if (item.mutation_type === "UPSERT_MAINTENANCE_WORK") {
          const work = item.payload_json?.work;
          if (!work) {
            return {
              status: "failure",
              errorMessage: "Hiányzó karbantartási szinkron payload.",
              retryable: false,
            };
          }
          response = await fetch(`/api/maintenance/works/${work.workId}/sync`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Mutation-Id": item.mutation_id,
            },
            credentials: "include",
            body: JSON.stringify({
              shift_id: work.shiftId,
              device_id: work.deviceId,
              status: work.status,
              started_at: work.startedAt,
              finished_at: work.finishedAt,
              aborted_at: work.abortedAt,
              malfunction_description: work.malfunctionDescription,
              followup_service_required: work.followupServiceRequired,
              followup_service_reasons: work.followupServiceReasons,
              followup_service_reason_other: work.followupServiceReasonOther,
              note: work.note,
            }),
          });
        } else if (item.mutation_type === "UPSERT_MAINTENANCE_PHOTO") {
          const photoPayload = item.payload_json?.photo;
          if (!photoPayload) {
            return {
              status: "failure",
              errorMessage: "Hiányzó fotó szinkron payload.",
              retryable: false,
            };
          }
          const storedPhoto = await getPhotoById(photoPayload.photoId);
          if (!storedPhoto) {
            await deleteOutboxRecord(db, item.id);
            return { status: "skip" };
          }
          const blob = await fetch(storedPhoto.url).then((result) => result.blob());
          const query = new URLSearchParams();
          if (photoPayload.captureNote) {
            query.set("capture_note", photoPayload.captureNote);
          }
          query.set("captured_at", photoPayload.capturedAt);
          query.set("photo_type", photoPayload.photoType);
          response = await fetch(
            `/api/maintenance/works/${photoPayload.workId}/photos/${photoPayload.photoId}?${query.toString()}`,
            {
              method: "PUT",
              headers: {
                "Content-Type": blob.type || "application/octet-stream",
                "X-Mutation-Id": item.mutation_id,
              },
              credentials: "include",
              body: blob,
            },
          );
        } else {
          const finalizePayload = item.payload_json?.finalize;
          if (!finalizePayload) {
            return {
              status: "failure",
              errorMessage: "Hiányzó karbantartás lezárási payload.",
              retryable: false,
            };
          }

          const work = finalizePayload.work;
          response = await fetch(`/api/maintenance/works/${work.workId}/sync`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Mutation-Id": item.mutation_id,
            },
            credentials: "include",
            body: JSON.stringify({
              shift_id: work.shiftId,
              device_id: work.deviceId,
              status: work.status,
              started_at: work.startedAt,
              finished_at: work.finishedAt,
              aborted_at: work.abortedAt,
              malfunction_description: work.malfunctionDescription,
              followup_service_required: work.followupServiceRequired,
              followup_service_reasons: work.followupServiceReasons,
              followup_service_reason_other: work.followupServiceReasonOther,
              note: work.note,
            }),
          });

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

          for (const photoPayload of finalizePayload.photos) {
            const storedPhoto = await getPhotoById(photoPayload.photoId);
            if (!storedPhoto) {
              continue;
            }

            const blob = await fetch(storedPhoto.url).then((result) => result.blob());
            const query = new URLSearchParams();
            if (photoPayload.captureNote) {
              query.set("capture_note", photoPayload.captureNote);
            }
            query.set("captured_at", photoPayload.capturedAt);
            query.set("photo_type", photoPayload.photoType);

            response = await fetch(
              `/api/maintenance/works/${photoPayload.workId}/photos/${photoPayload.photoId}?${query.toString()}`,
              {
                method: "PUT",
                headers: {
                  "Content-Type": blob.type || "application/octet-stream",
                  "X-Mutation-Id": `${item.mutation_id}:${photoPayload.photoId}`,
                },
                credentials: "include",
                body: blob,
              },
            );

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
          }

          await deleteOutboxRecord(db, item.id);
          return { status: "success" };
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

      await deleteOutboxRecord(db, item.id);

      return { status: "success" };
    },
    applyFailure: async (item, failure, attemptAt) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(SYNC_OUTBOX_STORE, "readwrite");
        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => resolve();
        tx.objectStore(SYNC_OUTBOX_STORE).put({
          ...item,
          status: "FAILED",
          retryable: failure.retryable,
          updated_at: new Date().toISOString(),
          last_attempt_at: attemptAt,
          attempt_count: item.attempt_count + 1,
          last_error: failure.errorMessage,
        } satisfies MaintenanceSyncOutboxRecord);
      }),
  });
};

const syncRunner = createSyncRunner({
  runSync: async () => {
    await syncPendingMaintenanceMutations();
  },
  baseIntervalMs: 60_000,
  maxIntervalMs: 5 * 60_000,
});

export const startMaintenanceOfflineSyncRunner = () => {
  syncRunner.start();
};

export const stopMaintenanceOfflineSyncRunner = () => {
  syncRunner.stop();
};

export const triggerMaintenanceOfflineSyncNow = () => {
  syncRunner.triggerNow();
};
