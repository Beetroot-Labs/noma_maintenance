-- An IN_PROGRESS shift created directly in the DB, with the seeded lead as the only
-- CACHE_READY participant. Stack on top of users_basic + building_with_10_devices.
-- Equivalent end-state to what create_shift produces, but bypasses the UI so specs
-- can focus on what happens *after* the shift exists.

WITH lead AS (
  SELECT id FROM users
  WHERE tenant_id = :tenant_id AND email = 'lead-:short@e2e.local'
),
building AS (
  SELECT id FROM buildings
  WHERE tenant_id = :tenant_id AND name = 'Test Building :short'
),
new_shift AS (
  INSERT INTO shifts (tenant_id, building_id, lead_user_id, status, started_at)
  SELECT :tenant_id, b.id, l.id, 'IN_PROGRESS', NOW()
  FROM lead l, building b
  RETURNING id
)
INSERT INTO shift_participants (tenant_id, shift_id, user_id, status, cache_ready_at)
SELECT :tenant_id, s.id, l.id, 'CACHE_READY', NOW()
FROM new_shift s, lead l;
