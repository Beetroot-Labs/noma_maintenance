-- Reset production-seeded data/schema objects, then recreate and seed.
-- Run with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/reset_prod.sql

-- Drop tables seeded/used by prod setup (and auth/session tables tied to users).
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS auth_identities CASCADE;
DROP TABLE IF EXISTS barcodes CASCADE;
DROP TABLE IF EXISTS devices CASCADE;
DROP TABLE IF EXISTS site_locations CASCADE;
DROP TABLE IF EXISTS buildings CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS tenants CASCADE;

-- Drop enum types created by setup.sql so setup can be re-applied cleanly.
DROP TYPE IF EXISTS tender_classification CASCADE;
DROP TYPE IF EXISTS device_kind CASCADE;
DROP TYPE IF EXISTS auth_provider CASCADE;
DROP TYPE IF EXISTS user_role CASCADE;

-- Recreate schema.
\ir setup.sql

-- Seed tenant/users + building/location/device data.
\ir prod_setup.sql
