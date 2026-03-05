import { useEffect, useState } from "react";

export type OfflineSyncStatus = "PENDING" | "IN_PROGRESS" | "FAILED" | "DONE";

export type OfflineOutboxItem<TPayload = unknown> = {
  id: string;
  mutation_type: string;
  entity_type: string;
  entity_id: string;
  payload_json: TPayload;
  status: OfflineSyncStatus;
  retryable: boolean;
  attempt_count: number;
  last_attempt_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type OfflineSyncStatusSummary = {
  pendingCount: number;
  inProgressCount: number;
  failedCount: number;
  retryableCount: number;
  hasRetryableChanges: boolean;
  hasSyncErrors: boolean;
};

export const summarizeOutboxItems = (
  items: Array<Pick<OfflineOutboxItem, "status" | "retryable">>,
): OfflineSyncStatusSummary => {
  let pendingCount = 0;
  let inProgressCount = 0;
  let failedCount = 0;
  let retryableCount = 0;

  for (const item of items) {
    if (item.status === "PENDING") {
      pendingCount += 1;
      retryableCount += 1;
      continue;
    }
    if (item.status === "IN_PROGRESS") {
      inProgressCount += 1;
      retryableCount += 1;
      continue;
    }
    if (item.status === "FAILED") {
      failedCount += 1;
      if (item.retryable) {
        retryableCount += 1;
      }
    }
  }

  return {
    pendingCount,
    inProgressCount,
    failedCount,
    retryableCount,
    hasRetryableChanges: retryableCount > 0,
    hasSyncErrors: failedCount > 0,
  };
};

export const isRetryableHttpStatus = (status: number): boolean =>
  status >= 500 || status === 429;

type SyncRunnerOptions = {
  runSync: () => Promise<void>;
  baseIntervalMs?: number;
  maxIntervalMs?: number;
};

export type SyncRunner = {
  start: () => void;
  stop: () => void;
  triggerNow: () => void;
};

export const createSyncRunner = ({
  runSync,
  baseIntervalMs = 60_000,
  maxIntervalMs = 5 * 60_000,
}: SyncRunnerOptions): SyncRunner => {
  let started = false;
  let timerId: number | null = null;
  let isRunning = false;
  let queuedRun = false;
  let retryDelayMs = baseIntervalMs;

  const clearTimer = () => {
    if (timerId != null) {
      window.clearTimeout(timerId);
      timerId = null;
    }
  };

  const schedule = (delayMs: number) => {
    clearTimer();
    timerId = window.setTimeout(() => {
      void runOnce();
    }, delayMs);
  };

  const runOnce = async () => {
    if (!started || isRunning) {
      queuedRun = true;
      return;
    }

    isRunning = true;
    queuedRun = false;

    try {
      await runSync();
      retryDelayMs = baseIntervalMs;
    } catch {
      retryDelayMs = Math.min(retryDelayMs * 2, maxIntervalMs);
    } finally {
      isRunning = false;
      if (!started) {
        clearTimer();
        return;
      }
      if (queuedRun) {
        queuedRun = false;
        void runOnce();
        return;
      }
      schedule(retryDelayMs);
    }
  };

  const handleOnline = () => {
    if (!started) {
      return;
    }
    void runOnce();
  };

  const handleVisibility = () => {
    if (!started || document.visibilityState !== "visible") {
      return;
    }
    void runOnce();
  };

  return {
    start: () => {
      if (started) {
        return;
      }
      started = true;
      window.addEventListener("online", handleOnline);
      document.addEventListener("visibilitychange", handleVisibility);
      void runOnce();
    },
    stop: () => {
      if (!started) {
        return;
      }
      started = false;
      clearTimer();
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibility);
    },
    triggerNow: () => {
      if (!started) {
        return;
      }
      void runOnce();
    },
  };
};

export const useOfflineSyncSummary = (
  loadSummary: () => Promise<OfflineSyncStatusSummary>,
  refreshIntervalMs = 5000,
) => {
  const [summary, setSummary] = useState<OfflineSyncStatusSummary>({
    pendingCount: 0,
    inProgressCount: 0,
    failedCount: 0,
    retryableCount: 0,
    hasRetryableChanges: false,
    hasSyncErrors: false,
  });

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      const next = await loadSummary();
      if (!cancelled) {
        setSummary(next);
      }
    };

    void refresh();
    const intervalId = window.setInterval(() => {
      void refresh();
    }, refreshIntervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [loadSummary, refreshIntervalMs]);

  return summary;
};
