-- Migrate any existing ACCEPTED participants to CACHE_READY before dropping the state.
-- ACCEPTED was a transient lead-only state between shift creation and cache prep completion.
-- With the new flow, the lead is inserted as CACHE_READY directly after cache prep.
UPDATE shift_participants
SET
    status = 'CACHE_READY',
    cache_ready_at = COALESCE(cache_ready_at, accepted_at, NOW())
WHERE status = 'ACCEPTED';

-- Drop the accepted_at column — cache_ready_at is the canonical "ready" timestamp now.
ALTER TABLE shift_participants DROP COLUMN accepted_at;

-- Replace the enum type without the ACCEPTED value.
ALTER TYPE shift_participant_status RENAME TO shift_participant_status_old;

CREATE TYPE shift_participant_status AS ENUM (
    'INVITED',
    'DECLINED',
    'CACHE_READY',
    'CLOSE_CONFIRMED'
);

ALTER TABLE shift_participants
    ALTER COLUMN status TYPE shift_participant_status
    USING status::text::shift_participant_status;

DROP TYPE shift_participant_status_old;
