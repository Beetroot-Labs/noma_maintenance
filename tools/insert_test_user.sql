BEGIN;

WITH upsert_tenant AS (
    INSERT INTO tenants (name)
    VALUES ('NoMa Klíma- és Hűtéstechnikai Kft.')
    ON CONFLICT (name) DO UPDATE
    SET name = EXCLUDED.name
    RETURNING id
)
INSERT INTO users (tenant_id, full_name, email, phone_number, role, email_verified_at)
SELECT
    upsert_tenant.id,
    'John Test',
    'hello@floomatik.com',
    '0036301234567',
    'TECHNICIAN',
    NOW()
FROM upsert_tenant
ON CONFLICT (tenant_id, email) DO UPDATE
SET
    full_name = EXCLUDED.full_name,
    phone_number = EXCLUDED.phone_number,
    role = EXCLUDED.role,
    email_verified_at = EXCLUDED.email_verified_at;

INSERT INTO users (tenant_id, full_name, email, phone_number, role, email_verified_at)
SELECT
    upsert_tenant.id,
    'Lead Domonkos',
    'suranyi.domi@gmail.com',
    '0036301234567',
    'LEAD_TECHNICIAN',
    NOW()
FROM upsert_tenant
ON CONFLICT (tenant_id, email) DO UPDATE
SET
    full_name = EXCLUDED.full_name,
    phone_number = EXCLUDED.phone_number,
    role = EXCLUDED.role,
    email_verified_at = EXCLUDED.email_verified_at;
COMMIT;
