-- +goose Up
-- 1. Extend users table for production authentication
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 2. Create user_sessions table for persistent session management
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(128) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_agent TEXT,
    ip_address VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);

-- 3. Extend ci_classes with form_fields JSONB specification
ALTER TABLE ci_classes ADD COLUMN IF NOT EXISTS form_fields JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 4. Relax cis.class_metadata constraint to allow rich dynamic form attributes (>2 keys)
ALTER TABLE cis DROP CONSTRAINT IF EXISTS chk_cis_class_metadata;
ALTER TABLE cis ADD CONSTRAINT chk_cis_class_metadata CHECK (
    jsonb_typeof(class_metadata) = 'object'
);

-- 5. Migrate cis.ci_class to VARCHAR(64) referencing ci_classes(id)
ALTER TABLE cis ALTER COLUMN ci_class TYPE VARCHAR(64) USING ci_class::text;
-- +goose StatementBegin
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_cis_ci_class'
    ) THEN
        ALTER TABLE cis ADD CONSTRAINT fk_cis_ci_class 
            FOREIGN KEY (ci_class) REFERENCES ci_classes(id) 
            ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;
END $$;
-- +goose StatementEnd

-- 6. Ensure baseline enterprise admin user and system roles exist
-- +goose StatementBegin
DO $$
BEGIN
    -- Ensure standard baseline custom roles exist if not already present
    INSERT INTO custom_roles (id, name, description, permissions, is_system, created_at, updated_at)
    SELECT 'c0000000-0000-0000-0000-000000000001', 'Platform Administrator', 'Full platform administrative privileges and governance control.', ARRAY['admin:all'], true, now() - interval '180 days', now() - interval '180 days'
    WHERE NOT EXISTS (SELECT 1 FROM custom_roles WHERE id = 'c0000000-0000-0000-0000-000000000001' OR name = 'Platform Administrator');

    INSERT INTO custom_roles (id, name, description, permissions, is_system, created_at, updated_at)
    SELECT 'c0000000-0000-0000-0000-000000000002', 'Service Owner', 'Owns, creates, and maintains service topology and metadata.', ARRAY['ci:read', 'ci:write', 'ci:flag', 'ci:retire', 'edge:manage'], false, now() - interval '180 days', now() - interval '180 days'
    WHERE NOT EXISTS (SELECT 1 FROM custom_roles WHERE id = 'c0000000-0000-0000-0000-000000000002' OR name = 'Service Owner');

    INSERT INTO custom_roles (id, name, description, permissions, is_system, created_at, updated_at)
    SELECT 'c0000000-0000-0000-0000-000000000003', 'Compliance Auditor', 'Read-only catalog and dependency access with audit log streaming privileges.', ARRAY['ci:read', 'audit:export'], false, now() - interval '180 days', now() - interval '180 days'
    WHERE NOT EXISTS (SELECT 1 FROM custom_roles WHERE id = 'c0000000-0000-0000-0000-000000000003' OR name = 'Compliance Auditor');

    -- Ensure platform admin user exists (single initial administrator)
    INSERT INTO users (id, email, name, role, primary_owner_group_id, custom_role_id, password_hash, status, created_at, updated_at)
    SELECT 
        '11111111-1111-1111-1111-111111111111', 
        'admin@enterprise.com', 
        'Admin User', 
        'platform_admin', 
        (SELECT id FROM owner_groups WHERE id = '10000000-0000-0000-0000-000000000001' LIMIT 1), 
        (SELECT id FROM custom_roles WHERE id = 'c0000000-0000-0000-0000-000000000001' OR name = 'Platform Administrator' LIMIT 1), 
        '', 
        'active', 
        now() - interval '180 days', 
        now()
    WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = '11111111-1111-1111-1111-111111111111' OR email = 'admin@enterprise.com');

    UPDATE users 
    SET status = 'active',
        role = 'platform_admin',
        custom_role_id = COALESCE(custom_role_id, (SELECT id FROM custom_roles WHERE id = 'c0000000-0000-0000-0000-000000000001' OR name = 'Platform Administrator' LIMIT 1))
    WHERE email = 'admin@enterprise.com' OR id = '11111111-1111-1111-1111-111111111111';
END $$;
-- +goose StatementEnd

-- 7. Update system CI classes with baseline form field specifications
UPDATE ci_classes 
SET form_fields = '[
    {"name": "sla", "label": "Service Level Agreement (SLA)", "type": "select", "required": true, "options": ["99.999%", "99.99%", "99.9%", "99.5%"], "default_value": "99.99%"},
    {"name": "business_unit", "label": "Business Unit", "type": "text", "required": false, "placeholder": "e.g. Retail Banking & Wealth"},
    {"name": "rto_minutes", "label": "Recovery Time Objective (RTO in mins)", "type": "number", "required": false, "placeholder": "15"},
    {"name": "rpo_minutes", "label": "Recovery Point Objective (RPO in mins)", "type": "number", "required": false, "placeholder": "0"}
]'::jsonb
WHERE id = 'business_service';

UPDATE ci_classes 
SET form_fields = '[
    {"name": "runtime", "label": "Execution Runtime", "type": "select", "required": true, "options": ["Go 1.23", "Java OpenJDK 21", "Node.js 22", "Python 3.12", "Rust 1.82", ".NET 8"], "default_value": "Go 1.23"},
    {"name": "framework", "label": "Application Framework", "type": "text", "required": false, "placeholder": "e.g. Chi, Spring Boot, Express, FastAPI"},
    {"name": "port", "label": "Service Port", "type": "number", "required": false, "placeholder": "8080"},
    {"name": "health_check_path", "label": "Health Check Path", "type": "text", "required": false, "placeholder": "/healthz"}
]'::jsonb
WHERE id = 'application';

UPDATE ci_classes 
SET form_fields = '[
    {"name": "engine", "label": "Database Engine", "type": "select", "required": true, "options": ["PostgreSQL 16", "Oracle RAC 19c", "Redis 7.2", "MySQL 8.0", "MongoDB 7.0"], "default_value": "PostgreSQL 16"},
    {"name": "version", "label": "Engine Version", "type": "text", "required": false, "placeholder": "e.g. 16.4-alpine"},
    {"name": "port", "label": "Port", "type": "number", "required": true, "placeholder": "5432"},
    {"name": "max_connections", "label": "Max Connections", "type": "number", "required": false, "placeholder": "200"}
]'::jsonb
WHERE id = 'database';

UPDATE ci_classes 
SET form_fields = '[
    {"name": "hypervisor", "label": "Hypervisor / Engine", "type": "select", "required": true, "options": ["VMware ESXi 8", "Proxmox VE 8", "KVM / OpenStack", "Hyper-V"], "default_value": "VMware ESXi 8"},
    {"name": "nodes", "label": "Cluster Node Count", "type": "number", "required": true, "placeholder": "e.g. 4"},
    {"name": "cluster_vip", "label": "Cluster Virtual IP", "type": "text", "required": false, "placeholder": "e.g. 10.100.2.10"}
]'::jsonb
WHERE id = 'vm_cluster';

UPDATE ci_classes 
SET form_fields = '[
    {"name": "rack_location", "label": "Data Center Rack Location", "type": "text", "required": true, "placeholder": "e.g. DC-1-RACK-12-U18"},
    {"name": "cpu_model", "label": "CPU Model", "type": "text", "required": false, "placeholder": "e.g. AMD EPYC 9654 96-Core"},
    {"name": "total_ram_gb", "label": "Total RAM (GB)", "type": "number", "required": false, "placeholder": "512"},
    {"name": "ilo_ip", "label": "iLO / IPMI Management IP", "type": "text", "required": false, "placeholder": "10.200.0.45"}
]'::jsonb
WHERE id = 'physical_host';

UPDATE ci_classes 
SET form_fields = '[
    {"name": "vendor_type", "label": "Firewall Vendor", "type": "select", "required": true, "options": ["Palo Alto Networks", "Fortinet FortiGate", "Cisco Firepower", "Check Point"], "default_value": "Palo Alto Networks"},
    {"name": "ha_mode", "label": "High Availability Mode", "type": "select", "required": true, "options": ["Active / Passive", "Active / Active", "Standalone"], "default_value": "Active / Passive"},
    {"name": "firmware_version", "label": "Firmware Version", "type": "text", "required": false, "placeholder": "PAN-OS 11.1"}
]'::jsonb
WHERE id = 'network_firewall';

-- 8. Insert or Update VM Server custom CI class with dedicated form fields
INSERT INTO ci_classes (id, label, category, description, icon, is_system, attributes, form_fields, created_at, updated_at)
VALUES (
    'vm_server',
    'VM Server',
    'Infrastructure',
    'Virtual machine server instance with compute, storage, and networking specs',
    'Server',
    false,
    ARRAY['server_name', 'ip_address', 'operating_system', 'memory_size', 'allocated_storage'],
    '[
        {"name": "server_name", "label": "Server Name", "type": "text", "required": true, "placeholder": "e.g. srv-prod-vm01"},
        {"name": "ip_address", "label": "IP Address", "type": "text", "required": true, "placeholder": "e.g. 10.240.12.8"},
        {"name": "operating_system", "label": "Operating System", "type": "select", "required": true, "options": ["Ubuntu 22.04 LTS", "Debian 12", "RHEL 9", "Windows Server 2022", "Alpine Linux"], "default_value": "Ubuntu 22.04 LTS"},
        {"name": "memory_size", "label": "Memory Size", "type": "text", "required": true, "placeholder": "e.g. 64 GB"},
        {"name": "allocated_storage", "label": "Allocated Storage", "type": "text", "required": true, "placeholder": "e.g. 500 GB NVMe"}
    ]'::jsonb,
    now(),
    now()
) ON CONFLICT (id) DO UPDATE SET 
    label = EXCLUDED.label,
    category = EXCLUDED.category,
    description = EXCLUDED.description,
    form_fields = EXCLUDED.form_fields,
    attributes = EXCLUDED.attributes,
    updated_at = now();

-- +goose Down
DROP TABLE IF EXISTS user_sessions;
ALTER TABLE users DROP COLUMN IF EXISTS updated_at;
ALTER TABLE users DROP COLUMN IF EXISTS status;
ALTER TABLE users DROP COLUMN IF EXISTS password_hash;
ALTER TABLE ci_classes DROP COLUMN IF EXISTS form_fields;
