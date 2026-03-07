CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";

CREATE TYPE user_role AS ENUM (
    'ADMIN',
    'LEAD_TECHNICIAN',
    'TECHNICIAN',
    'VIEWER'
);

CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
    name TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    email CITEXT NOT NULL,
    phone_number TEXT,
    role user_role NOT NULL DEFAULT 'TECHNICIAN',
    email_verified_at TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

    CONSTRAINT users_tenant_email_unique UNIQUE (tenant_id, email),
    CONSTRAINT users_tenant_id_id_unique UNIQUE (tenant_id, id)
);

CREATE TYPE auth_provider AS ENUM ('PASSWORD', 'GOOGLE');

CREATE TABLE auth_identities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider auth_provider NOT NULL,
    provider_subject text,
    password_hash TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    last_used_at TIMESTAMPTZ,
    -- One Google account cannot be linked twice
    CONSTRAINT auth_provider_subject_unique UNIQUE (provider, provider_subject),

    -- A user can have at most one PASSWORD identity
    CONSTRAINT auth_one_password_per_user UNIQUE (user_id, provider),

    -- Basic sanity rules:
    CONSTRAINT auth_google_subject_required CHECK (
        (provider <> 'GOOGLE') OR (provider_subject IS NOT NULL)
    ),
    CONSTRAINT auth_password_hash_required CHECK (
        (provider <> 'PASSWORD') OR (password_hash IS NOT NULL)
    )
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  ip INET,
  user_agent TEXT
);

CREATE TYPE device_kind AS ENUM (
    'WINDOW_AIR_CONDITIONER',
    'FAN_COIL',
    'COMFORT_FAN_COIL',
    'AIR_CURTAIN',
    'SPLIT_UNIT',
    'SPLIT_INDOOR_UNIT',
    'SERVER_ROOM_SPLIT_INDOOR_UNIT',
    'AIR_HANDLING_UNIT',
    'VRV_INDOOR_UNIT',
    'VRV_OUTDOOR_UNIT',
    'FAN',
    'LIQUID_CHILLER',
    'CONDENSER'
);

CREATE TYPE tender_classification AS ENUM (
    'WINDOW_AIR_CONDITIONER_UP_TO_2_5_KW',
    'WINDOW_AIR_CONDITIONER_ABOVE_2_5_KW',
    'INDOOR_UNIT_UP_TO_2_5_KW',
    'INDOOR_UNIT_ABOVE_2_5_KW',
    'LIQUID_CHILLER_UP_TO_50_KW',
    'LIQUID_CHILLER_50_TO_100_KW',
    'LIQUID_CHILLER_100_TO_500_KW',
    'CONDENSER_ABOVE_80_KW',
    'SPLIT_DUAL_MULTI_AC_UP_TO_5_KW',
    'SPLIT_DUAL_MULTI_AC_5_TO_10_KW',
    'SPLIT_DUAL_MULTI_AC_ABOVE_10_KW',
    'AIR_HANDLING_UNIT_UP_TO_3000_M3_H',
    'AIR_HANDLING_UNIT_3000_TO_5000_M3_H',
    'AIR_HANDLING_UNIT_5000_TO_10000_M3_H',
    'AIR_HANDLING_UNIT_10000_TO_30000_M3_H',
    'VRV_OUTDOOR_UNIT_UP_TO_20_KW',
    'VRV_OUTDOOR_UNIT_20_TO_30_KW',
    'VRV_OUTDOOR_UNIT_30_TO_50_KW',
    'VRV_OUTDOOR_UNIT_ABOVE_50_KW',
    'AXIAL_FAN_BELOW_1000_M3_H',
    'AXIAL_FAN_1000_TO_3000_M3_H',
    'AXIAL_FAN_3000_TO_5000_M3_H',
    'AXIAL_FAN_ABOVE_5000_M3_H'
);

CREATE TABLE buildings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT buildings_tenant_name_unique UNIQUE (tenant_id, name),
    CONSTRAINT buildings_tenant_id_id_unique UNIQUE (tenant_id, id)
);

CREATE TABLE site_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    building_id UUID,
    floor TEXT,
    wing TEXT,
    location_description TEXT,
    room TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT site_locations_tenant_building_fk
        FOREIGN KEY (tenant_id, building_id)
        REFERENCES buildings (tenant_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT site_locations_tenant_id_id_unique UNIQUE (tenant_id, id)
);

CREATE TABLE devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    location_id UUID,
    kind device_kind NOT NULL,
    tender_classification tender_classification,
    maintenance_frequency_per_year INTEGER CHECK (maintenance_frequency_per_year IS NULL OR maintenance_frequency_per_year > 0),
    additional_info TEXT,
    brand TEXT,
    model TEXT,
    serial_number TEXT,
    source_device_code TEXT,
    device_photo_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT devices_tenant_location_fk
        FOREIGN KEY (tenant_id, location_id)
        REFERENCES site_locations (tenant_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT devices_tenant_id_id_unique UNIQUE (tenant_id, id)
);

CREATE TABLE barcodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    code VARCHAR(18) NOT NULL,
    device_id UUID,
    deactivated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT barcodes_tenant_code_unique UNIQUE (tenant_id, code),
    CONSTRAINT barcodes_tenant_device_fk
        FOREIGN KEY (tenant_id, device_id)
        REFERENCES devices (tenant_id, id)
        ON DELETE RESTRICT
);

CREATE TABLE processed_mutations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    endpoint_key TEXT NOT NULL,
    mutation_id TEXT NOT NULL,
    response_status INTEGER NOT NULL,
    response_body JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT processed_mutations_tenant_endpoint_mutation_unique
        UNIQUE (tenant_id, endpoint_key, mutation_id)
);

CREATE TYPE shift_status AS ENUM (
    'INVITING',
    'READY_TO_START',
    'IN_PROGRESS',
    'CLOSE_REQUESTED',
    'READY_TO_COMMIT',
    'COMMITTED',
    'CANCELLED'
);

CREATE TYPE shift_participant_status AS ENUM (
    'INVITED',
    'DECLINED',
    'ACCEPTED',
    'CACHE_READY',
    'CLOSE_CONFIRMED'
);

CREATE TABLE shifts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    building_id UUID NOT NULL,
    lead_user_id UUID NOT NULL,
    status shift_status NOT NULL DEFAULT 'INVITING',
    started_at TIMESTAMPTZ,
    close_requested_at TIMESTAMPTZ,
    summary_generated_at TIMESTAMPTZ,
    committed_at TIMESTAMPTZ,
    referent_name TEXT,
    referent_signature_url TEXT,
    referent_signed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT shifts_tenant_building_fk
        FOREIGN KEY (tenant_id, building_id)
        REFERENCES buildings (tenant_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT shifts_tenant_lead_user_fk
        FOREIGN KEY (tenant_id, lead_user_id)
        REFERENCES users (tenant_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT shifts_tenant_id_id_unique UNIQUE (tenant_id, id)
);

CREATE TABLE shift_participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    shift_id UUID NOT NULL,
    user_id UUID NOT NULL,
    status shift_participant_status NOT NULL DEFAULT 'INVITED',
    invited_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    accepted_at TIMESTAMPTZ,
    cache_ready_at TIMESTAMPTZ,
    close_confirmed_at TIMESTAMPTZ,
    CONSTRAINT shift_participants_tenant_shift_fk
        FOREIGN KEY (tenant_id, shift_id)
        REFERENCES shifts (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT shift_participants_tenant_user_fk
        FOREIGN KEY (tenant_id, user_id)
        REFERENCES users (tenant_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT shift_participants_shift_user_unique UNIQUE (shift_id, user_id)
);

CREATE TYPE maintenance_work_status AS ENUM (
    'IN_PROGRESS',
    'FINISHED',
    'ABORTED'
);

CREATE TABLE maintenance_works (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    shift_id UUID NOT NULL,
    device_id UUID NOT NULL,
    maintainer_user_id UUID NOT NULL,
    status maintenance_work_status NOT NULL DEFAULT 'IN_PROGRESS',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    aborted_at TIMESTAMPTZ,
    malfunction_description TEXT,
    note TEXT,
    CONSTRAINT maintenance_works_tenant_shift_fk
        FOREIGN KEY (tenant_id, shift_id)
        REFERENCES shifts (tenant_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT maintenance_works_tenant_device_fk
        FOREIGN KEY (tenant_id, device_id)
        REFERENCES devices (tenant_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT maintenance_works_tenant_user_fk
        FOREIGN KEY (tenant_id, maintainer_user_id)
        REFERENCES users (tenant_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT maintenance_works_malfunction_description_not_empty CHECK (
        malfunction_description IS NULL OR NULLIF(BTRIM(malfunction_description), '') IS NOT NULL
    ),
    CONSTRAINT maintenance_works_finished_at_required CHECK (
        status <> 'FINISHED' OR finished_at IS NOT NULL
    ),
    CONSTRAINT maintenance_works_aborted_at_required CHECK (
        status <> 'ABORTED' OR aborted_at IS NOT NULL
    ),
    CONSTRAINT maintenance_works_tenant_id_id_unique UNIQUE (tenant_id, id)
);

CREATE TYPE maintenance_photo_type AS ENUM (
    'MAINTENANCE',
    'MALFUNCTION'
);

CREATE TABLE maintenance_photos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    maintenance_work_id UUID NOT NULL,
    photo_type maintenance_photo_type NOT NULL DEFAULT 'MAINTENANCE',
    photo_url TEXT NOT NULL,
    capture_note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT maintenance_photos_tenant_work_fk
        FOREIGN KEY (tenant_id, maintenance_work_id)
        REFERENCES maintenance_works (tenant_id, id)
        ON DELETE CASCADE
);

CREATE UNIQUE INDEX barcodes_one_active_per_device_idx
ON barcodes (device_id)
WHERE device_id IS NOT NULL AND deactivated_at IS NULL;

CREATE INDEX buildings_tenant_id_idx
ON buildings (tenant_id);

CREATE INDEX site_locations_tenant_building_idx
ON site_locations (tenant_id, building_id);

CREATE INDEX site_locations_tenant_floor_idx
ON site_locations (tenant_id, floor);

CREATE INDEX site_locations_tenant_wing_idx
ON site_locations (tenant_id, wing);

CREATE INDEX site_locations_tenant_room_idx
ON site_locations (tenant_id, room);

CREATE INDEX devices_tenant_location_idx
ON devices (tenant_id, location_id);

CREATE INDEX devices_tenant_kind_idx
ON devices (tenant_id, kind);

CREATE INDEX devices_tenant_tender_classification_idx
ON devices (tenant_id, tender_classification);

CREATE UNIQUE INDEX devices_tenant_source_device_code_unique_idx
ON devices (tenant_id, source_device_code)
WHERE source_device_code IS NOT NULL;

CREATE INDEX barcodes_tenant_device_idx
ON barcodes (tenant_id, device_id);

CREATE INDEX processed_mutations_tenant_created_idx
ON processed_mutations (tenant_id, created_at DESC);

CREATE INDEX shifts_tenant_status_idx
ON shifts (tenant_id, status);

CREATE INDEX shifts_tenant_building_idx
ON shifts (tenant_id, building_id);

CREATE INDEX shifts_tenant_lead_idx
ON shifts (tenant_id, lead_user_id);

CREATE INDEX shift_participants_tenant_shift_idx
ON shift_participants (tenant_id, shift_id);

CREATE INDEX shift_participants_tenant_user_idx
ON shift_participants (tenant_id, user_id);

CREATE INDEX shift_participants_shift_status_idx
ON shift_participants (shift_id, status);

CREATE INDEX maintenance_works_tenant_shift_idx
ON maintenance_works (tenant_id, shift_id);

CREATE INDEX maintenance_works_tenant_device_idx
ON maintenance_works (tenant_id, device_id);

CREATE INDEX maintenance_works_tenant_user_idx
ON maintenance_works (tenant_id, maintainer_user_id);

CREATE INDEX maintenance_works_tenant_status_idx
ON maintenance_works (tenant_id, status);

CREATE UNIQUE INDEX maintenance_works_one_active_per_user_idx
ON maintenance_works (tenant_id, maintainer_user_id)
WHERE status = 'IN_PROGRESS';

CREATE UNIQUE INDEX maintenance_works_one_active_per_device_idx
ON maintenance_works (tenant_id, device_id)
WHERE status = 'IN_PROGRESS';

CREATE INDEX maintenance_photos_tenant_work_idx
ON maintenance_photos (tenant_id, maintenance_work_id);
