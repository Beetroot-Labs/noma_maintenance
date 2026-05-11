-- Four users, one per role, with tenant-scoped email local-parts. The `:short` placeholder
-- is the first 8 hex chars of the tenant id; tests resolve the same addresses via the
-- userEmail() helper in helpers/users.ts. Tenant-scoping is required because the users
-- table accumulates rows across tests (no truncation between tests; isolation is by
-- tenant_id), and the dev-login route looks up by email — static emails would collide.

INSERT INTO users (tenant_id, full_name, email, role) VALUES
  (:tenant_id, 'Test Admin',     'admin-:short@e2e.local',  'ADMIN'),
  (:tenant_id, 'Test Lead',      'lead-:short@e2e.local',   'LEAD_TECHNICIAN'),
  (:tenant_id, 'Test Tech One',  'tech1-:short@e2e.local',  'TECHNICIAN'),
  (:tenant_id, 'Test Tech Two',  'tech2-:short@e2e.local',  'TECHNICIAN');
