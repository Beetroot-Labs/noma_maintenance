-- Stack on top of users_basic + building_with_10_devices.
--
-- Two scenarios use this preset:
--   1. /shifts/current showing the "Műszak összegzése" button (E19 / lead_starts_shift_summary).
--      The relevant condition is `areAllParticipantsConfirmed`, which is true when every
--      non-declined participant is CLOSE_CONFIRMED. `hasActiveShiftAccess` requires the
--      shift to be in {READY_TO_START, IN_PROGRESS, CLOSE_REQUESTED}, so we keep the
--      *shift* in CLOSE_REQUESTED. This satisfies both gates simultaneously.
--   2. /shifts/:shiftId/summary (J9 commit path). The signature-upload backend requires
--      shift status to be exactly READY_TO_COMMIT (backend/src/shifts.rs:1978). Specs
--      that exercise the commit POST therefore call applyReadyToCommitTransition()
--      after this preset to flip the status — that helper lives in helpers/shifts.ts.
--
-- The participant-status trigger blocks INSERT to shift_participants while the parent
-- shift is frozen (READY_TO_COMMIT/COMMITTED/CANCELLED), which is why participants are
-- inserted while the shift is still CLOSE_REQUESTED.

DO $$
DECLARE
  v_lead_id UUID;
  v_tech1_id UUID;
  v_building_id UUID;
  v_shift_id UUID;
BEGIN
  SELECT id INTO v_lead_id
    FROM users WHERE tenant_id = :tenant_id AND email = 'lead-:short@e2e.local';
  SELECT id INTO v_tech1_id
    FROM users WHERE tenant_id = :tenant_id AND email = 'tech1-:short@e2e.local';
  SELECT id INTO v_building_id
    FROM buildings WHERE tenant_id = :tenant_id AND name = 'Test Building :short';

  INSERT INTO shifts (tenant_id, building_id, lead_user_id, status, started_at, close_requested_at)
  VALUES (:tenant_id, v_building_id, v_lead_id, 'CLOSE_REQUESTED',
          NOW() - INTERVAL '2 hour', NOW() - INTERVAL '5 minute')
  RETURNING id INTO v_shift_id;

  INSERT INTO shift_participants (tenant_id, shift_id, user_id, status, cache_ready_at, close_confirmed_at)
  VALUES
    (:tenant_id, v_shift_id, v_lead_id,  'CLOSE_CONFIRMED', NOW() - INTERVAL '2 hour', NOW() - INTERVAL '5 minute'),
    (:tenant_id, v_shift_id, v_tech1_id, 'CLOSE_CONFIRMED', NOW() - INTERVAL '2 hour', NOW() - INTERVAL '5 minute');
END $$;
