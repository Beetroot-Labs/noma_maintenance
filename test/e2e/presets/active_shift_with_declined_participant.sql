-- IN_PROGRESS shift with the lead as CACHE_READY and tech1 as a DECLINED participant.
-- Stack on top of users_basic + building_with_10_devices. Tech2 (still in users) is left
-- as a candidate for the add-participant flow.

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
),
add_lead AS (
  INSERT INTO shift_participants (tenant_id, shift_id, user_id, status, cache_ready_at)
  SELECT :tenant_id, s.id, l.id, 'CACHE_READY', NOW()
  FROM new_shift s, lead l
  RETURNING id
)
INSERT INTO shift_participants (tenant_id, shift_id, user_id, status, invited_at)
SELECT :tenant_id, s.id, t.id, 'DECLINED', NOW()
FROM new_shift s, tech1 t;
