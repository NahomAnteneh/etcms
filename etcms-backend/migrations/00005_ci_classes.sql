-- +goose Up
CREATE TABLE IF NOT EXISTS ci_classes (
    id VARCHAR(64) PRIMARY KEY,
    label VARCHAR(120) NOT NULL,
    category VARCHAR(64) NOT NULL DEFAULT 'Application',
    description TEXT NOT NULL DEFAULT '',
    icon VARCHAR(64) NOT NULL DEFAULT 'Layers',
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    attributes TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO ci_classes (id, label, category, description, icon, is_system) VALUES
('business_service', 'Business Service', 'Service', 'High-level business service consumed by external or internal users', 'Layers', true),
('application', 'Application', 'Application', 'Core software microservice, backend worker, or application component', 'Cpu', true),
('database', 'Database', 'Data', 'Persistent transactional database, cache, or data store', 'Database', true),
('vm_cluster', 'VM Cluster', 'Infrastructure', 'Virtual machine hypervisor cluster or compute cluster pool', 'Server', true),
('physical_host', 'Bare Metal Host', 'Infrastructure', 'Physical server hardware, bare-metal hypervisor, or dedicated host', 'HardDrive', true),
('network_firewall', 'Network Firewall', 'Network', 'Network perimeter gateway, firewall device, or load balancer', 'Network', true)
ON CONFLICT (id) DO NOTHING;

-- +goose Down
DROP TABLE IF EXISTS ci_classes;
