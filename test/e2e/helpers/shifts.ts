// Helpers for state transitions that the production app drives via API calls but the
// preset DSL can't express atomically.

import { dbQuery } from "./db";

// Flip a CLOSE_REQUESTED shift to READY_TO_COMMIT for the given tenant. Required before
// specs that exercise the commit-flow endpoints (PUT signature-image + POST commit),
// because backend/src/shifts.rs:1978 rejects signature uploads on any other status.
// In production this transition happens through `confirm_shift_close` when the final
// non-lead participant syncs their close-confirm; presets bypass that path.
export const promoteShiftToReadyToCommit = async (
  tenantId: string,
): Promise<void> => {
  await dbQuery(
    "UPDATE shifts SET status = 'READY_TO_COMMIT' WHERE tenant_id = $1",
    [tenantId],
  );
};
