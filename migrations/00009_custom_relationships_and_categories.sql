-- +goose Up
-- 1. Unlock all CI classes so none are locked/preseeded
UPDATE ci_classes SET is_system = FALSE;
ALTER TABLE ci_classes ALTER COLUMN is_system SET DEFAULT FALSE;

-- 2. Create ci_categories table for full category management
CREATE TABLE IF NOT EXISTS ci_categories (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    icon VARCHAR(64) NOT NULL DEFAULT 'Layers',
    color VARCHAR(32) NOT NULL DEFAULT 'cyan',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed baseline enterprise categories
INSERT INTO ci_categories (id, name, description, icon, color)
VALUES
    ('infrastructure', 'Infrastructure', 'Physical and virtual compute, storage, and datacenter hardware', 'Server', 'amber'),
    ('data', 'Data', 'Databases, caches, object storage, and messaging queues', 'Database', 'emerald'),
    ('application', 'Application', 'Web services, microservices, background jobs, and API gateways', 'Cpu', 'cyan'),
    ('service', 'Service', 'High-level business capabilities and digital customer services', 'Layers', 'violet'),
    ('network', 'Network', 'Load balancers, firewalls, routers, switches, and edge proxies', 'Network', 'rose')
ON CONFLICT (id) DO NOTHING;

-- 3. Create relationship_types table for custom relationship definitions
CREATE TABLE IF NOT EXISTS relationship_types (
    id VARCHAR(64) PRIMARY KEY,
    label VARCHAR(128) NOT NULL,
    reverse_label VARCHAR(128) NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    color VARCHAR(32) NOT NULL DEFAULT 'cyan',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed baseline relationship types
INSERT INTO relationship_types (id, label, reverse_label, description, color)
VALUES
    ('depends_on', 'Depends On', 'Depended On By', 'Upstream CI functionally depends on downstream component', 'cyan'),
    ('hosted_on', 'Hosted On', 'Hosts', 'Virtual or logical workload hosted on physical/virtual compute infrastructure', 'amber'),
    ('connects_to', 'Connects To', 'Connected From', 'Network or protocol socket connection between endpoints', 'emerald'),
    ('reads_from', 'Reads From', 'Read By', 'Data consumer reading from database, replica, or topic', 'violet')
ON CONFLICT (id) DO NOTHING;

-- 4. Convert ci_edges.edge_type from enum to VARCHAR(64) referencing relationship_types(id)
ALTER TABLE ci_edges ALTER COLUMN edge_type TYPE VARCHAR(64) USING edge_type::text;

-- +goose StatementBegin
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_ci_edges_edge_type'
    ) THEN
        ALTER TABLE ci_edges ADD CONSTRAINT fk_ci_edges_edge_type
            FOREIGN KEY (edge_type) REFERENCES relationship_types(id)
            ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;
END $$;
-- +goose StatementEnd

-- +goose Down
ALTER TABLE ci_edges DROP CONSTRAINT IF EXISTS fk_ci_edges_edge_type;
DROP TABLE IF EXISTS relationship_types;
DROP TABLE IF EXISTS ci_categories;
