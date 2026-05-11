-- IN_PROGRESS shift with the lead and tech1 both CACHE_READY. Stack on top of
-- users_basic + building_with_10_devices. Used by close-request / summary specs that
-- need at least one non-lead participant in the shift.

WITH lead AS (
  SELECT id FROM users
  WHERE tenant_id = :tenant_id AND email = 'lead-:short@e2e.local'
),
tech1 AS (
  SELECT id FROM users
  WHERE tenant_id = :tenant_id AND email = 'tech1-:short@e2e.local'
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
SELECT :tenant_id, s.id, u.id, 'CACHE_READY', NOW()
FROM new_shift s,
     (SELECT id FROM users WHERE tenant_id = :tenant_id
        AND email IN ('lead-:short@e2e.local', 'tech1-:short@e2e.local')) u;
