-- An IN_PROGRESS maintenance_works row owned by tech1, referencing the existing shift
-- and the first device in the building (ORDER BY id LIMIT 1). Stack on top of one of the
-- active_shift_*_tech1* presets so the shift + device + tech1 user are present.

INSERT INTO maintenance_works (tenant_id, shift_id, device_id, maintainer_user_id, status, kind)
SELECT :tenant_id, s.id, d.id, t.id, 'IN_PROGRESS', 'ROUTINE'
FROM
  (SELECT id FROM shifts WHERE tenant_id = :tenant_id) s,
  (SELECT id FROM users WHERE tenant_id = :tenant_id AND email = 'tech1-:short@e2e.local') t,
  (SELECT id FROM devices WHERE tenant_id = :tenant_id ORDER BY id LIMIT 1) d;
