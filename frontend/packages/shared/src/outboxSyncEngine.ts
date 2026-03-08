export type OutboxSyncItemResult =
  | {
      status: "success";
    }
  | {
      status: "failure";
      errorMessage: string;
      retryable: boolean;
    }
  | {
      status: "skip";
    };

export type OutboxPrepareResult = "proceed" | "skip";

type OutboxSyncEngineOptions<TItem> = {
  listPendingItems: () => Promise<TItem[]>;
  prepareAttempt: (item: TItem, attemptAt: string) => Promise<OutboxPrepareResult>;
  runItem: (item: TItem) => Promise<OutboxSyncItemResult>;
  applyFailure: (
    item: TItem,
    failure: { errorMessage: string; retryable: boolean },
    attemptAt: string,
  ) => Promise<void>;
};

export const runOutboxSyncEngine = async <TItem>({
  listPendingItems,
  prepareAttempt,
  runItem,
  applyFailure,
}: OutboxSyncEngineOptions<TItem>): Promise<void> => {
  const pendingItems = await listPendingItems();

  for (const item of pendingItems) {
    const attemptAt = new Date().toISOString();
    const prepareResult = await prepareAttempt(item, attemptAt);
    if (prepareResult === "skip") {
      continue;
    }

    try {
      const result = await runItem(item);
      if (result.status === "failure") {
        await applyFailure(
          item,
          { errorMessage: result.errorMessage, retryable: result.retryable },
          attemptAt,
        );
      }
    } catch (error) {
      await applyFailure(
        item,
        {
          errorMessage:
            error instanceof Error ? error.message : "Sikertelen szinkronizáció.",
          retryable: true,
        },
        attemptAt,
      );
    }
  }
};
