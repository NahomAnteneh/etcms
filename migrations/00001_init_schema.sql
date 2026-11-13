-- +goose Up
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enum Types
CREATE TYPE ci_class_enum AS ENUM (
    'business_service',
    'application',
    'database',
    'vm_cluster',
    'physical_host',
    'network_firewall'
);

CREATE TYPE lifecycle_state_enum AS ENUM (
    'planned',
    'in_service',
    'deprecated',
    'retired'
);

CREATE TYPE criticality_tier_enum AS ENUM (
    'tier_0',
    'tier_1',
    'tier_2',
    'tier_3'
);

CREATE TYPE edge_type_enum AS ENUM (
    'depends_on',
    'hosted_on',
    'connects_to',
    'reads_from'
);

CREATE TYPE handshake_status_enum AS ENUM (
    'pending_confirmation',
    'confirmed',
    'flagged_mismatch',
    'rejected'
);

CREATE TYPE environment_enum AS ENUM (
    'prod',
    'dr',
    'staging'
);

CREATE TYPE user_role_enum AS ENUM (
    'viewer',
    'team_lead',
    'platform_admin'
);

CREATE TYPE audit_action_enum AS ENUM (
    'create',
    'update',
    'retire',
    'verify',
    'confirm',
    'flag',
    'disconnect'
);

CREATE TYPE flag_status_enum AS ENUM (
    'open',
    'resolved',
    'dismissed'
);

-- Helper functions
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_jsonb_key_count(j jsonb) RETURNS integer
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT count(*)::integer FROM jsonb_object_keys(j);
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION trg_audit_logs_prevent_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is strictly prohibited', TG_OP;
END;
$$;
-- +goose StatementEnd

-- Core Tables
CREATE TABLE owner_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(160) NOT NULL,
    slug VARCHAR(80) NOT NULL UNIQUE,
    department_name VARCHAR(160) NOT NULL,
    team_lead_name VARCHAR(160) NOT NULL,
    team_lead_email VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(160) NOT NULL,
    role user_role_enum NOT NULL DEFAULT 'viewer',
    primary_owner_group_id UUID REFERENCES owner_groups(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_owner_groups (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    owner_group_id UUID NOT NULL REFERENCES owner_groups(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, owner_group_id)
);

CREATE TABLE cis (
    ci_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(160) NOT NULL,
    ci_class ci_class_enum NOT NULL,
    environment environment_enum NOT NULL,
    lifecycle_state lifecycle_state_enum NOT NULL DEFAULT 'in_service',
    criticality_tier criticality_tier_enum NOT NULL,
    owner_group_id UUID NOT NULL REFERENCES owner_groups(id) ON DELETE RESTRICT,
    technical_contact VARCHAR(160) NOT NULL,
    primary_endpoint VARCHAR(255),
    last_verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    itam_external_ref VARCHAR(512),
    class_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_cis_class_metadata CHECK (
        jsonb_typeof(class_metadata) = 'object' AND fn_jsonb_key_count(class_metadata) <= 2
    )
);

CREATE UNIQUE INDEX uq_cis_active_name ON cis (lower(name), ci_class, environment) WHERE lifecycle_state != 'retired';
CREATE INDEX idx_cis_name_trgm ON cis USING gin (name gin_trgm_ops);
CREATE INDEX idx_cis_primary_endpoint_trgm ON cis USING gin (primary_endpoint gin_trgm_ops);
CREATE INDEX idx_cis_owner_group ON cis (owner_group_id);
CREATE INDEX idx_cis_lifecycle_state ON cis (lifecycle_state);

CREATE TABLE ci_edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_ci_id UUID NOT NULL REFERENCES cis(ci_id) ON DELETE RESTRICT,
    target_ci_id UUID NOT NULL REFERENCES cis(ci_id) ON DELETE RESTRICT,
    edge_type edge_type_enum NOT NULL,
    handshake_status handshake_status_enum NOT NULL DEFAULT 'pending_confirmation',
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    confirmed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_ci_edges_no_self_ref CHECK (source_ci_id != target_ci_id),
    CONSTRAINT uq_ci_edges_source_target_type UNIQUE (source_ci_id, target_ci_id, edge_type)
);

CREATE INDEX idx_ci_edges_source ON ci_edges (source_ci_id);
CREATE INDEX idx_ci_edges_target ON ci_edges (target_ci_id);
CREATE INDEX idx_ci_edges_handshake ON ci_edges (handshake_status);

CREATE TABLE baselines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID,
    owner_group_id UUID NOT NULL REFERENCES owner_groups(id) ON DELETE RESTRICT,
    version_tag VARCHAR(32) NOT NULL,
    snapshot JSONB NOT NULL,
    published_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    published_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ci_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ci_id UUID NOT NULL REFERENCES cis(ci_id) ON DELETE CASCADE,
    flagged_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reason TEXT NOT NULL,
    status flag_status_enum NOT NULL DEFAULT 'open',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(64) NOT NULL,
    entity_id UUID NOT NULL,
    affected_owner_group_ids UUID[] NOT NULL DEFAULT '{}',
    actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action audit_action_enum NOT NULL,
    diff JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_entity ON audit_logs (entity_type, entity_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs (created_at);
CREATE INDEX idx_audit_logs_actor_id ON audit_logs (actor_id);
CREATE INDEX idx_audit_logs_affected_groups ON audit_logs USING gin (affected_owner_group_ids);

CREATE TRIGGER audit_logs_no_update_delete
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION trg_audit_logs_prevent_mutation();

CREATE TRIGGER audit_logs_no_truncate
BEFORE TRUNCATE ON audit_logs
EXECUTE FUNCTION trg_audit_logs_prevent_mutation();

-- +goose Down
DROP TRIGGER IF EXISTS audit_logs_no_truncate ON audit_logs;
DROP TRIGGER IF EXISTS audit_logs_no_update_delete ON audit_logs;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS ci_flags;
DROP TABLE IF EXISTS baselines;
DROP TABLE IF EXISTS ci_edges;
DROP TABLE IF EXISTS cis;
DROP TABLE IF EXISTS user_owner_groups;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS owner_groups;

DROP FUNCTION IF EXISTS trg_audit_logs_prevent_mutation();
DROP FUNCTION IF EXISTS fn_jsonb_key_count(jsonb);

DROP TYPE IF EXISTS flag_status_enum;
DROP TYPE IF EXISTS audit_action_enum;
DROP TYPE IF EXISTS user_role_enum;
DROP TYPE IF EXISTS environment_enum;
DROP TYPE IF EXISTS handshake_status_enum;
DROP TYPE IF EXISTS edge_type_enum;
DROP TYPE IF EXISTS criticality_tier_enum;
DROP TYPE IF EXISTS lifecycle_state_enum;
DROP TYPE IF EXISTS ci_class_enum;
