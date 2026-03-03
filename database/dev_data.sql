BEGIN;

WITH upsert_tenant AS (
    INSERT INTO tenants (name)
    VALUES ('NoMa Klíma- és Hűtéstechnikai Kft.')
    ON CONFLICT (name) DO UPDATE
    SET name = EXCLUDED.name
    RETURNING id
)
INSERT INTO users (tenant_id, full_name, email, email_verified_at)
SELECT
    upsert_tenant.id,
    'Surányi Domonkos',
    'floomatik@nomahutes.hu',
    NOW()
FROM upsert_tenant
ON CONFLICT (tenant_id, email) DO UPDATE
SET
    full_name = EXCLUDED.full_name,
    email_verified_at = EXCLUDED.email_verified_at;

-- Google sign-in requires the real Google "sub" claim as provider_subject.
-- Add this after the first successful Google login flow is wired up:
--
-- INSERT INTO auth_identities (user_id, provider, provider_subject)
-- SELECT
--     u.id,
--     'GOOGLE',
--     '<google-provider-subject>'
-- FROM users u
-- JOIN tenants t ON t.id = u.tenant_id
-- WHERE t.name = 'NoMa Klíma- és Hűtéstechnikai Kft.'
--   AND u.email = 'floomatik@nomahutes.hu'
-- ON CONFLICT (user_id, provider) DO UPDATE
-- SET provider_subject = EXCLUDED.provider_subject;

COMMIT;
