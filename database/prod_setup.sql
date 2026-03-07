BEGIN;

WITH upsert_tenant AS (
    INSERT INTO tenants (name)
    VALUES ('NoMa Klíma- és Hűtéstechnikai Kft.')
    ON CONFLICT (name) DO UPDATE
    SET name = EXCLUDED.name
    RETURNING id
),
user_seed(full_name, email, role_label, phone) AS (
    VALUES
        ('Surányi Domonkos', 'floomatik@nomahutes.hu', 'ADMIN', '0036305865232'),
        ('NoMa Automation', 'hello@floomatik.com', 'ADMIN', '0036309227530'),
        ('Teszt Domonkos', 'suranyi.domi@gmail.com', 'TECHNICIAN', '0036305865232'),
        ('Nowacki Krisztián', 'krisztian@nomahutes.hu', 'ADMIN', '0036305546968'),
        ('Szalma Dániel', 'daniel@nomahutes.hu', 'ADMIN', '0036309232368')
)
INSERT INTO users (tenant_id, full_name, email, phone_number, role, email_verified_at)
SELECT
    t.id,
    s.full_name,
    s.email,
    s.phone,
    s.role_label::user_role,
    NOW()
FROM upsert_tenant t
CROSS JOIN user_seed s
ON CONFLICT (tenant_id, email) DO UPDATE
SET
    full_name = EXCLUDED.full_name,
    phone_number = EXCLUDED.phone_number,
    role = EXCLUDED.role,
    email_verified_at = EXCLUDED.email_verified_at;

COMMIT;

-- Import the real building/location/device seed for the same tenant.
\ir device_data.sql
