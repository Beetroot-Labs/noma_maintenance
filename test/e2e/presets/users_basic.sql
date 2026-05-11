-- Four users with stable role-suffixed emails. The :tenant_id placeholder is substituted
-- by applyPreset() before this file is sent to Postgres, so every test gets its own copy.

INSERT INTO users (tenant_id, full_name, email, role) VALUES
  (:tenant_id, 'Test Admin',     'admin@e2e.local',  'ADMIN'),
  (:tenant_id, 'Test Lead',      'lead@e2e.local',   'LEAD_TECHNICIAN'),
  (:tenant_id, 'Test Tech One',  'tech1@e2e.local',  'TECHNICIAN'),
  (:tenant_id, 'Test Tech Two',  'tech2@e2e.local',  'TECHNICIAN');
