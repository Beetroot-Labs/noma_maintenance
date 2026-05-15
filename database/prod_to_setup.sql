BEGIN;

ALTER TABLE shifts
ADD COLUMN IF NOT EXISTS service_worksheets_url TEXT;

CREATE TABLE IF NOT EXISTS proposals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    url TEXT,
    device_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    net_price NUMERIC NOT NULL,
    currency TEXT NOT NULL DEFAULT 'Ft',
    note TEXT,
    CONSTRAINT proposals_tenant_device_fk
        FOREIGN KEY (tenant_id, device_id)
        REFERENCES devices (tenant_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT proposals_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT proposals_currency_not_empty CHECK (NULLIF(BTRIM(currency), '') IS NOT NULL),
    CONSTRAINT proposals_net_price_non_negative CHECK (net_price >= 0)
);

ALTER TABLE proposals
ADD COLUMN IF NOT EXISTS note TEXT;

ALTER TABLE proposals
ALTER COLUMN currency SET DEFAULT 'Ft';

CREATE TABLE IF NOT EXISTS proposal_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    proposal_id UUID NOT NULL,
    position INTEGER NOT NULL,
    item TEXT NOT NULL,
    quantity NUMERIC NOT NULL,
    uom TEXT NOT NULL,
    net_unit_price NUMERIC NOT NULL,
    CONSTRAINT proposal_lines_tenant_proposal_fk
        FOREIGN KEY (tenant_id, proposal_id)
        REFERENCES proposals (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT proposal_lines_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT proposal_lines_tenant_proposal_position_unique UNIQUE (tenant_id, proposal_id, position),
    CONSTRAINT proposal_lines_position_positive CHECK (position > 0),
    CONSTRAINT proposal_lines_item_not_empty CHECK (NULLIF(BTRIM(item), '') IS NOT NULL),
    CONSTRAINT proposal_lines_uom_not_empty CHECK (NULLIF(BTRIM(uom), '') IS NOT NULL),
    CONSTRAINT proposal_lines_quantity_positive CHECK (quantity > 0),
    CONSTRAINT proposal_lines_net_unit_price_non_negative CHECK (net_unit_price >= 0)
);

CREATE OR REPLACE FUNCTION prevent_modifying_frozen_shift()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' AND OLD.status IN ('READY_TO_COMMIT', 'COMMITTED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Frozen shifts cannot be deleted.';
    END IF;

    IF TG_OP <> 'UPDATE' THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    IF OLD.status = 'CANCELLED' THEN
        RAISE EXCEPTION 'Cancelled shifts cannot be modified.';
    END IF;

    IF OLD.status = 'READY_TO_COMMIT' THEN
        IF NEW.id IS DISTINCT FROM OLD.id
           OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
           OR NEW.building_id IS DISTINCT FROM OLD.building_id
           OR NEW.lead_user_id IS DISTINCT FROM OLD.lead_user_id
           OR NEW.started_at IS DISTINCT FROM OLD.started_at
           OR NEW.close_requested_at IS DISTINCT FROM OLD.close_requested_at
           OR NEW.report_url IS DISTINCT FROM OLD.report_url
           OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'Ready-to-commit shifts only allow commit-related fields to change.';
        END IF;

        IF NEW.status NOT IN ('READY_TO_COMMIT', 'COMMITTED') THEN
            RAISE EXCEPTION 'Ready-to-commit shifts can only remain ready-to-commit or become committed.';
        END IF;

        RETURN NEW;
    END IF;

    IF OLD.status = 'COMMITTED' THEN
        IF NEW.status = OLD.status
           AND NEW.id IS NOT DISTINCT FROM OLD.id
           AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id
           AND NEW.building_id IS NOT DISTINCT FROM OLD.building_id
           AND NEW.lead_user_id IS NOT DISTINCT FROM OLD.lead_user_id
           AND NEW.started_at IS NOT DISTINCT FROM OLD.started_at
           AND NEW.close_requested_at IS NOT DISTINCT FROM OLD.close_requested_at
           AND NEW.summary_generated_at IS NOT DISTINCT FROM OLD.summary_generated_at
           AND NEW.committed_at IS NOT DISTINCT FROM OLD.committed_at
           AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
           AND (
                OLD.report_url IS NOT DISTINCT FROM NEW.report_url
                OR (OLD.report_url IS NULL AND NEW.report_url IS NOT NULL)
           ) THEN
            RETURN NEW;
        END IF;

        IF OLD.report_url IS NOT NULL AND NEW.report_url IS DISTINCT FROM OLD.report_url THEN
            RAISE EXCEPTION 'Committed shift report_url cannot be modified once set.';
        END IF;

        RAISE EXCEPTION 'Committed shifts cannot be modified except for setting report_url once or updating service_worksheets_url.';
    END IF;

    RETURN NEW;
END;
$$;

CREATE INDEX IF NOT EXISTS proposals_tenant_created_idx
ON proposals (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS proposals_tenant_device_idx
ON proposals (tenant_id, device_id);

CREATE INDEX IF NOT EXISTS proposal_lines_tenant_proposal_idx
ON proposal_lines (tenant_id, proposal_id, position);

COMMIT;
