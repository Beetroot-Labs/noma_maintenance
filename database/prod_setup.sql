BEGIN;

WITH upsert_tenant AS (
    INSERT INTO tenants (name)
    VALUES ('NoMa Klíma- és Hűtéstechnikai Kft.')
    ON CONFLICT (name) DO UPDATE
    SET name = EXCLUDED.name
    RETURNING id
),
user_seed(full_name, email, role_label) AS (
    VALUES
        ('Surányi Domonkos', 'floomatik@nomahutes.hu', 'ADMIN'),
        ('NoMa Automation', 'hello@floomatik.com', 'ADMIN'),
        ('Teszt Domonkos', 'suranyi.domi@gmail.com', 'TECHNICIAN'),
        ('Nowacki Krisztián', 'krisztian@nomahutes.hu', 'ADMIN'),
        ('Szalma Dániel', 'daniel@nomahutes.hu', 'ADMIN')
)
INSERT INTO users (tenant_id, full_name, email, email_verified_at)
SELECT
    t.id,
    s.full_name,
    s.email,
    NOW()
FROM upsert_tenant t
CROSS JOIN user_seed s
ON CONFLICT (tenant_id, email) DO UPDATE
SET
    full_name = EXCLUDED.full_name,
    email_verified_at = EXCLUDED.email_verified_at;

COMMIT;

-- NOTE:
-- The current schema does not store per-user role (ADMIN/TECHNICIAN) on the users table.
-- The role labels above are documented input values only.
--
-- Import the real building/location/device seed for the same tenant.
\ir device_data.sql
