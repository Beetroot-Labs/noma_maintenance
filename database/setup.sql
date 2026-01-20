CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";

CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(50) UNIQUE NOT NULL
);

CREATE TABLE permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) UNIQUE NOT NULL
);

CREATE TABLE role_permissions (
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    email CITEXT NOT NULL,
    role_id UUID REFERENCES roles(id),
    email_verified_at TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT users_tenant_email_unique UNIQUE (tenant_id, email)
);

CREATE TYPE auth_provider AS ENUM ('PASSWORD', 'GOOGLE');

CREATE TABLE auth_identities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    provider auth_provider NOT NULL,
    provider_subject text,
    password_hash TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
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
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  ip INET,
  user_agent TEXT
);

CREATE TYPE device_kind AS ENUM (
    'FAN_COIL_UNIT',
    'INDOOR_UNIT',
    'CONDENSER',
    'FAN',
    'AIR_HANDLER_UNIT',
    'VRF_OUTDOOR_UNIT',
    'CHILLER'
);

CREATE TABLE devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    kind device_kind NOT NULL,
    building_name TEXT,
    building_location TEXT,
    floor TEXT,
    room TEXT,
    additional_info TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT devices_tenant_code_unique UNIQUE (tenant_id, code)
);

CREATE TABLE site_visits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
    visit_start TIMESTAMPTZ NOT NULL,
    visit_end TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE site_visit_photos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_visit_id UUID REFERENCES site_visits(id) ON DELETE CASCADE,
    photo_url TEXT NOT NULL,
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);
