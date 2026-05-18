BEGIN;

ALTER TABLE proposals
ADD COLUMN IF NOT EXISTS current_version_number INTEGER NOT NULL DEFAULT 1;

ALTER TABLE proposals
ALTER COLUMN current_version_number SET DEFAULT 1;

ALTER TABLE proposals
ALTER COLUMN current_version_number SET NOT NULL;

CREATE TABLE IF NOT EXISTS proposal_versions (
    proposal_id UUID NOT NULL,
    version_number INTEGER NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    device_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    net_price NUMERIC NOT NULL,
    currency TEXT NOT NULL DEFAULT 'Ft',
    note TEXT,
    url TEXT,
    CONSTRAINT proposal_versions_proposal_pk PRIMARY KEY (proposal_id, version_number),
    CONSTRAINT proposal_versions_tenant_proposal_version_unique UNIQUE (tenant_id, proposal_id, version_number),
    CONSTRAINT proposal_versions_tenant_proposal_fk
        FOREIGN KEY (tenant_id, proposal_id)
        REFERENCES proposals (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT proposal_versions_tenant_device_fk
        FOREIGN KEY (tenant_id, device_id)
        REFERENCES devices (tenant_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT proposal_versions_currency_not_empty CHECK (NULLIF(BTRIM(currency), '') IS NOT NULL),
    CONSTRAINT proposal_versions_net_price_non_negative CHECK (net_price >= 0),
    CONSTRAINT proposal_versions_version_number_positive CHECK (version_number > 0)
);

ALTER TABLE proposal_lines
ADD COLUMN IF NOT EXISTS version_number INTEGER NOT NULL DEFAULT 1;

ALTER TABLE proposal_lines
ALTER COLUMN version_number SET DEFAULT 1;

ALTER TABLE proposal_lines
ALTER COLUMN version_number SET NOT NULL;

INSERT INTO proposal_versions (
    proposal_id,
    version_number,
    tenant_id,
    device_id,
    created_at,
    created_by,
    net_price,
    currency,
    note,
    url
)
SELECT
    p.id,
    1,
    p.tenant_id,
    p.device_id,
    p.created_at,
    p.created_by,
    p.net_price,
    p.currency,
    p.note,
    p.url
FROM proposals p
LEFT JOIN proposal_versions pv
  ON pv.proposal_id = p.id
 AND pv.version_number = 1
WHERE pv.proposal_id IS NULL;

ALTER TABLE proposal_lines
DROP CONSTRAINT IF EXISTS proposal_lines_tenant_proposal_fk;

ALTER TABLE proposal_lines
DROP CONSTRAINT IF EXISTS proposal_lines_tenant_proposal_position_unique;

ALTER TABLE proposal_lines
DROP CONSTRAINT IF EXISTS proposal_lines_tenant_version_fk;

ALTER TABLE proposal_lines
ADD CONSTRAINT proposal_lines_tenant_version_fk
    FOREIGN KEY (tenant_id, proposal_id, version_number)
    REFERENCES proposal_versions (tenant_id, proposal_id, version_number)
    ON DELETE CASCADE;

ALTER TABLE proposal_lines
ADD CONSTRAINT proposal_lines_tenant_proposal_position_unique UNIQUE (tenant_id, proposal_id, version_number, position);

ALTER TABLE proposals
DROP COLUMN IF EXISTS url;

ALTER TABLE proposals
DROP COLUMN IF EXISTS device_id;

ALTER TABLE proposals
DROP COLUMN IF EXISTS created_at;

ALTER TABLE proposals
DROP COLUMN IF EXISTS created_by;

ALTER TABLE proposals
DROP COLUMN IF EXISTS net_price;

ALTER TABLE proposals
DROP COLUMN IF EXISTS currency;

ALTER TABLE proposals
DROP COLUMN IF EXISTS note;

CREATE INDEX IF NOT EXISTS proposal_versions_tenant_created_idx
ON proposal_versions (tenant_id, created_at DESC);

DROP INDEX IF EXISTS proposals_tenant_created_idx;
DROP INDEX IF EXISTS proposals_tenant_device_idx;
DROP INDEX IF EXISTS proposal_lines_tenant_proposal_idx;

COMMIT;
