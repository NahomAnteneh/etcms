-- +goose Up
-- Digest Enum Types
CREATE TYPE digest_cycle_status_enum AS ENUM (
    'open',
    'closed'
);

CREATE TYPE digest_item_status_enum AS ENUM (
    'open',
    'actioned',
    'expired'
);

-- Digest Cycles Table
CREATE TABLE digest_cycles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_group_id UUID NOT NULL REFERENCES owner_groups(id) ON DELETE CASCADE,
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,
    status digest_cycle_status_enum NOT NULL DEFAULT 'open',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ,
    CONSTRAINT uq_digest_cycles_group_window UNIQUE (owner_group_id, window_start)
);

CREATE INDEX idx_digest_cycles_owner_group ON digest_cycles(owner_group_id);
CREATE INDEX idx_digest_cycles_status ON digest_cycles(status);
CREATE INDEX idx_digest_cycles_window_start ON digest_cycles(window_start);

-- Digest Items Table
CREATE TABLE digest_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_id UUID NOT NULL REFERENCES digest_cycles(id) ON DELETE CASCADE,
    ci_id UUID NOT NULL REFERENCES cis(ci_id) ON DELETE CASCADE,
    trigger_reason VARCHAR(64) NOT NULL,
    status digest_item_status_enum NOT NULL DEFAULT 'open',
    actioned_at TIMESTAMPTZ,
    action_type VARCHAR(32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_digest_items_cycle_ci UNIQUE (cycle_id, ci_id)
);

CREATE INDEX idx_digest_items_cycle ON digest_items(cycle_id);
CREATE INDEX idx_digest_items_ci ON digest_items(ci_id);
CREATE INDEX idx_digest_items_status ON digest_items(status);

-- +goose Down
DROP TABLE IF EXISTS digest_items;
DROP TABLE IF EXISTS digest_cycles;

DROP TYPE IF EXISTS digest_item_status_enum;
DROP TYPE IF EXISTS digest_cycle_status_enum;
