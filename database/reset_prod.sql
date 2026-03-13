-- Reset production-seeded data/schema objects, then recreate and seed.
-- Run with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/reset_prod.sql

-- Drop business-domain tables first.
DROP TABLE IF EXISTS maintenance_photos CASCADE;
DROP TABLE IF EXISTS maintenance_works CASCADE;
DROP TABLE IF EXISTS shift_signatures CASCADE;
DROP TABLE IF EXISTS shift_participants CASCADE;
DROP TABLE IF EXISTS shifts CASCADE;
DROP TABLE IF EXISTS processed_mutations CASCADE;
DROP TABLE IF EXISTS barcodes CASCADE;
DROP TABLE IF EXISTS devices CASCADE;
DROP TABLE IF EXISTS site_locations CASCADE;
DROP TABLE IF EXISTS buildings CASCADE;

-- Drop auth/core tables after business tables.
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS auth_identities CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS tenants CASCADE;

-- Drop enum types created by setup.sql so setup can be re-applied cleanly.
DROP TYPE IF EXISTS maintenance_photo_type CASCADE;
DROP TYPE IF EXISTS maintenance_followup_reason CASCADE;
DROP TYPE IF EXISTS maintenance_work_status CASCADE;
DROP TYPE IF EXISTS shift_participant_status CASCADE;
DROP TYPE IF EXISTS shift_status CASCADE;
DROP TYPE IF EXISTS tender_classification CASCADE;
DROP TYPE IF EXISTS device_kind CASCADE;
DROP TYPE IF EXISTS auth_provider CASCADE;
DROP TYPE IF EXISTS user_role CASCADE;

-- Drop helper functions created by setup.sql.
DROP FUNCTION IF EXISTS assert_shift_not_frozen(UUID, UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS prevent_modifying_frozen_shift() CASCADE;
DROP FUNCTION IF EXISTS prevent_modifying_participants_of_frozen_shift() CASCADE;
DROP FUNCTION IF EXISTS prevent_modifying_signature_of_finalized_shift() CASCADE;
DROP FUNCTION IF EXISTS prevent_modifying_maintenance_of_frozen_shift() CASCADE;
DROP FUNCTION IF EXISTS prevent_modifying_photos_of_frozen_shift() CASCADE;

-- Recreate schema.
\ir setup.sql

-- Seed tenant/users + building/location/device data.
\ir prod_setup.sql
