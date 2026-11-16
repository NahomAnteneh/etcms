-- ETCMS Enterprise Seed Data
-- Comprehensive realistic enterprise CMDB dataset covering 50+ CIs across 7 classes, 
-- multi-tier topologies, varied lifecycle/environments, handshakes, audit logs, and campaigns.

BEGIN;

-- Temporarily disable audit immutability triggers for clean re-seeding
ALTER TABLE audit_logs DISABLE TRIGGER ALL;

TRUNCATE TABLE digest_items CASCADE;
TRUNCATE TABLE digest_cycles CASCADE;
TRUNCATE TABLE intake_submissions CASCADE;
TRUNCATE TABLE intake_invitations CASCADE;
TRUNCATE TABLE intake_campaigns CASCADE;
TRUNCATE TABLE baselines CASCADE;
TRUNCATE TABLE ci_flags CASCADE;
TRUNCATE TABLE ci_edges CASCADE;
TRUNCATE TABLE cis CASCADE;
TRUNCATE TABLE user_sessions CASCADE;
TRUNCATE TABLE user_owner_groups CASCADE;
TRUNCATE TABLE users CASCADE;
TRUNCATE TABLE owner_groups CASCADE;
TRUNCATE TABLE custom_roles CASCADE;
TRUNCATE TABLE audit_logs;

ALTER TABLE audit_logs ENABLE TRIGGER ALL;

-- ====================================================================
-- 1. Custom Roles & System Permissions
-- ====================================================================
INSERT INTO custom_roles (id, name, description, permissions, is_system, created_at, updated_at)
VALUES
    ('c0000000-0000-0000-0000-000000000001', 'Platform Administrator', 'Full platform administrative privileges and governance control.', ARRAY['admin:all'], true, now() - interval '180 days', now() - interval '180 days'),
    ('c0000000-0000-0000-0000-000000000002', 'Service Owner', 'Owns, creates, and maintains service topology and metadata.', ARRAY['ci:read', 'ci:write', 'ci:flag', 'ci:retire', 'edge:manage'], false, now() - interval '180 days', now() - interval '180 days'),
    ('c0000000-0000-0000-0000-000000000003', 'Compliance Auditor', 'Read-only catalog and dependency access with audit log streaming privileges.', ARRAY['ci:read', 'audit:export'], false, now() - interval '180 days', now() - interval '180 days')
ON CONFLICT (id) DO NOTHING;

-- ====================================================================
-- 2. Owner Groups
-- ====================================================================
INSERT INTO owner_groups (id, name, slug, department_name, team_lead_name, team_lead_email, created_at)
VALUES
    ('20000000-0000-0000-0000-000000000001', 'Platform Engineering', 'platform-engineering', 'Infrastructure & Cloud', 'Alex Chen', 'alex.chen@enterprise.com', now() - interval '120 days'),
    ('20000000-0000-0000-0000-000000000002', 'Core Banking & Payments', 'core-banking-payments', 'Financial Systems', 'Sarah Jenkins', 'sarah.jenkins@enterprise.com', now() - interval '120 days'),
    ('20000000-0000-0000-0000-000000000003', 'Site Reliability Engineering', 'site-reliability-engineering', 'Infrastructure & Operations', 'Marcus Vance', 'marcus.vance@enterprise.com', now() - interval '120 days'),
    ('20000000-0000-0000-0000-000000000004', 'Database Operations', 'database-operations', 'Data Infrastructure', 'Priya Patel', 'priya.patel@enterprise.com', now() - interval '120 days'),
    ('20000000-0000-0000-0000-000000000005', 'Security Operations', 'security-operations', 'Information Security & Compliance', 'David O''Connor', 'david.oconnor@enterprise.com', now() - interval '120 days'),
    ('20000000-0000-0000-0000-000000000006', 'Digital Customer Portal', 'digital-customer-portal', 'Digital Banking Experience', 'Elena Rostova', 'elena.rostova@enterprise.com', now() - interval '120 days'),
    ('20000000-0000-0000-0000-000000000007', 'Data Platform & Analytics', 'data-platform-analytics', 'Data & AI', 'Tariq Mansoor', 'tariq.mansoor@enterprise.com', now() - interval '120 days')
ON CONFLICT (id) DO NOTHING;

-- ====================================================================
-- 3. Users (Bcrypt hash: Admin123!)
-- Hash: $2a$10$uEuJ6WdqENXe9LPk0i9vG.d5jIBVSlRNQakXT3oj86U68ZP8A031K
-- ====================================================================
INSERT INTO users (id, email, name, role, primary_owner_group_id, custom_role_id, password_hash, status, created_at, updated_at)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'admin@enterprise.com', 'Admin User', 'platform_admin', '20000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', '$2a$10$uEuJ6WdqENXe9LPk0i9vG.d5jIBVSlRNQakXT3oj86U68ZP8A031K', 'active', now() - interval '120 days', now() - interval '120 days'),
    ('30000000-0000-0000-0000-000000000001', 'alex.chen@enterprise.com', 'Alex Chen', 'team_lead', '20000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', '$2a$10$uEuJ6WdqENXe9LPk0i9vG.d5jIBVSlRNQakXT3oj86U68ZP8A031K', 'active', now() - interval '120 days', now() - interval '120 days'),
    ('30000000-0000-0000-0000-000000000002', 'sarah.jenkins@enterprise.com', 'Sarah Jenkins', 'team_lead', '20000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', '$2a$10$uEuJ6WdqENXe9LPk0i9vG.d5jIBVSlRNQakXT3oj86U68ZP8A031K', 'active', now() - interval '120 days', now() - interval '120 days'),
    ('30000000-0000-0000-0000-000000000003', 'marcus.vance@enterprise.com', 'Marcus Vance', 'team_lead', '20000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000002', '$2a$10$uEuJ6WdqENXe9LPk0i9vG.d5jIBVSlRNQakXT3oj86U68ZP8A031K', 'active', now() - interval '120 days', now() - interval '120 days'),
    ('30000000-0000-0000-0000-000000000004', 'priya.patel@enterprise.com', 'Priya Patel', 'team_lead', '20000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000002', '$2a$10$uEuJ6WdqENXe9LPk0i9vG.d5jIBVSlRNQakXT3oj86U68ZP8A031K', 'active', now() - interval '120 days', now() - interval '120 days'),
    ('30000000-0000-0000-0000-000000000005', 'david.oconnor@enterprise.com', 'David O''Connor', 'team_lead', '20000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000002', '$2a$10$uEuJ6WdqENXe9LPk0i9vG.d5jIBVSlRNQakXT3oj86U68ZP8A031K', 'active', now() - interval '120 days', now() - interval '120 days'),
    ('30000000-0000-0000-0000-000000000006', 'elena.rostova@enterprise.com', 'Elena Rostova', 'team_lead', '20000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-000000000002', '$2a$10$uEuJ6WdqENXe9LPk0i9vG.d5jIBVSlRNQakXT3oj86U68ZP8A031K', 'active', now() - interval '120 days', now() - interval '120 days'),
    ('30000000-0000-0000-0000-000000000007', 'tariq.mansoor@enterprise.com', 'Tariq Mansoor', 'team_lead', '20000000-0000-0000-0000-000000000007', 'c0000000-0000-0000-0000-000000000002', '$2a$10$uEuJ6WdqENXe9LPk0i9vG.d5jIBVSlRNQakXT3oj86U68ZP8A031K', 'active', now() - interval '120 days', now() - interval '120 days'),
    ('30000000-0000-0000-0000-000000000008', 'audrey.auditor@enterprise.com', 'Audrey Auditor', 'viewer', '20000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000003', '$2a$10$uEuJ6WdqENXe9LPk0i9vG.d5jIBVSlRNQakXT3oj86U68ZP8A031K', 'active', now() - interval '120 days', now() - interval '120 days')
ON CONFLICT (id) DO NOTHING;

-- User Owner Group Memberships
INSERT INTO user_owner_groups (user_id, owner_group_id)
VALUES
    ('11111111-1111-1111-1111-111111111111', '20000000-0000-0000-0000-000000000001'),
    ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001'),
    ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002'),
    ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003'),
    ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004'),
    ('30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000005'),
    ('30000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000006'),
    ('30000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000007'),
    ('30000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000005')
ON CONFLICT (user_id, owner_group_id) DO NOTHING;

-- ====================================================================
-- 4. Configuration Items (CIs) — 50 Enterprise Assets
-- ====================================================================
INSERT INTO cis (ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact, primary_endpoint, last_verified_at, itam_external_ref, class_metadata, created_at, updated_at)
VALUES
    -- Tier 0 Core Business Services
    ('40000000-0000-0000-0000-000000000001', 'Core Banking & Settlement', 'business_service', 'prod', 'in_service', 'tier_0', '20000000-0000-0000-0000-000000000002', 'Sarah Jenkins', 'https://banking.enterprise.corp/api', now() - interval '14 days', 'ITAM-BS-001', '{"tier": "tier_0", "slo": "99.999%"}'::jsonb, now() - interval '100 days', now() - interval '14 days'),
    ('40000000-0000-0000-0000-000000000002', 'Global Real-Time Payments', 'business_service', 'prod', 'in_service', 'tier_0', '20000000-0000-0000-0000-000000000002', 'Sarah Jenkins', 'https://pay.enterprise.corp/gateway', now() - interval '10 days', 'ITAM-BS-002', '{"tier": "tier_0", "slo": "99.995%"}'::jsonb, now() - interval '100 days', now() - interval '10 days'),
    ('40000000-0000-0000-0000-000000000003', 'Digital Consumer Online Banking', 'business_service', 'prod', 'in_service', 'tier_1', '20000000-0000-0000-0000-000000000006', 'Elena Rostova', 'https://online.enterprise.corp', now() - interval '8 days', 'ITAM-BS-003', '{"tier": "tier_1", "slo": "99.95%"}'::jsonb, now() - interval '90 days', now() - interval '8 days'),
    ('40000000-0000-0000-0000-000000000004', 'Mobile Banking Platform', 'business_service', 'prod', 'in_service', 'tier_1', '20000000-0000-0000-0000-000000000006', 'Elena Rostova', 'https://mobile-gw.enterprise.corp', now() - interval '20 days', 'ITAM-BS-004', '{"tier": "tier_1", "slo": "99.9%"}'::jsonb, now() - interval '90 days', now() - interval '20 days'),
    ('40000000-0000-0000-0000-000000000005', 'Financial Intelligence & Analytics', 'business_service', 'prod', 'in_service', 'tier_2', '20000000-0000-0000-0000-000000000007', 'Tariq Mansoor', 'https://analytics.enterprise.corp', now() - interval '25 days', 'ITAM-BS-005', '{"tier": "tier_2", "slo": "99.5%"}'::jsonb, now() - interval '80 days', now() - interval '25 days'),
    ('40000000-0000-0000-0000-000000000006', 'Customer Alert & Notification Service', 'business_service', 'prod', 'in_service', 'tier_2', '20000000-0000-0000-0000-000000000006', 'Elena Rostova', 'https://alerts.enterprise.corp', now() - interval '30 days', 'ITAM-BS-006', '{"tier": "tier_2", "slo": "99.5%"}'::jsonb, now() - interval '80 days', now() - interval '30 days'),
    ('40000000-0000-0000-0000-000000000007', 'Core Banking Standby Service', 'business_service', 'dr', 'in_service', 'tier_0', '20000000-0000-0000-0000-000000000002', 'Sarah Jenkins', 'https://dr-banking.enterprise.corp', now() - interval '15 days', 'ITAM-BS-007', '{"tier": "tier_0", "rto_minutes": 15}'::jsonb, now() - interval '100 days', now() - interval '15 days'),
    ('40000000-0000-0000-0000-000000000008', 'NextGen Open Banking API', 'business_service', 'prod', 'planned', 'tier_2', '20000000-0000-0000-0000-000000000001', 'Alex Chen', 'https://openbank.preview.enterprise.corp', now() - interval '5 days', 'ITAM-BS-008', '{"stage": "rfc_review", "target_q": "Q1 2027"}'::jsonb, now() - interval '20 days', now() - interval '5 days'),

    -- Applications
    ('40000000-0000-0000-0000-000000000010', 'payment-gateway-api', 'application', 'prod', 'in_service', 'tier_0', '20000000-0000-0000-0000-000000000002', 'Sarah Jenkins', 'https://api-pay.prod.internal:8443', now() - interval '12 days', 'ITAM-APP-010', '{"runtime": "golang:1.23", "replicas": 12}'::jsonb, now() - interval '100 days', now() - interval '12 days'),
    ('40000000-0000-0000-0000-000000000011', 'general-ledger-engine', 'application', 'prod', 'in_service', 'tier_0', '20000000-0000-0000-0000-000000000002', 'Sarah Jenkins', 'grpc://ledger.prod.internal:9090', now() - interval '14 days', 'ITAM-APP-011', '{"runtime": "rust:1.80", "concurrency": "high"}'::jsonb, now() - interval '100 days', now() - interval '14 days'),
    ('40000000-0000-0000-0000-000000000012', 'fraud-scoring-service', 'application', 'prod', 'in_service', 'tier_0', '20000000-0000-0000-0000-000000000005', 'David O''Connor', 'https://fraud.sec.internal:8000', now() - interval '18 days', 'ITAM-APP-012', '{"model": "xgboost-fraud-v4", "latency_ms": 15}'::jsonb, now() - interval '95 days', now() - interval '18 days'),
    ('40000000-0000-0000-0000-000000000013', 'identity-access-broker', 'application', 'prod', 'in_service', 'tier_0', '20000000-0000-0000-0000-000000000005', 'David O''Connor', 'https://auth.enterprise.corp/oauth2', now() - interval '7 days', 'ITAM-APP-013', '{"protocol": "OIDC/OAuth2", "mfa": true}'::jsonb, now() - interval '110 days', now() - interval '7 days'),
    ('40000000-0000-0000-0000-000000000014', 'accounts-aggregate-api', 'application', 'prod', 'in_service', 'tier_1', '20000000-0000-0000-0000-000000000002', 'Sarah Jenkins', 'https://accounts.prod.internal:8080', now() - interval '22 days', 'ITAM-APP-014', '{"framework": "spring-boot", "version": "3.3"}'::jsonb, now() - interval '90 days', now() - interval '22 days'),
    ('40000000-0000-0000-0000-000000000015', 'customer-web-bff', 'application', 'prod', 'in_service', 'tier_1', '20000000-0000-0000-0000-000000000006', 'Elena Rostova', 'https://bff-web.prod.internal:4000', now() - interval '9 days', 'ITAM-APP-015', '{"runtime": "nodejs:22", "framework": "fastify"}'::jsonb, now() - interval '90 days', now() - interval '9 days'),
    ('40000000-0000-0000-0000-000000000016', 'mobile-bff-proxy', 'application', 'prod', 'in_service', 'tier_1', '20000000-0000-0000-0000-000000000006', 'Elena Rostova', 'https://bff-mobile.prod.internal:4000', now() - interval '19 days', 'ITAM-APP-016', '{"runtime": "nodejs:22", "framework": "fastify"}'::jsonb, now() - interval '90 days', now() - interval '19 days'),
    ('40000000-0000-0000-0000-000000000017', 'notification-dispatcher-worker', 'application', 'prod', 'in_service', 'tier_2', '20000000-0000-0000-0000-000000000006', 'Elena Rostova', 'amqp://notify-worker.prod.internal', now() - interval '28 days', 'ITAM-APP-017', '{"channels": "sms,email,push", "concurrency": 16}'::jsonb, now() - interval '80 days', now() - interval '28 days'),
    ('40000000-0000-0000-0000-000000000018', 'spark-settlement-batch', 'application', 'prod', 'in_service', 'tier_2', '20000000-0000-0000-0000-000000000007', 'Tariq Mansoor', 'spark://master.prod.internal:7077', now() - interval '35 days', 'ITAM-APP-018', '{"engine": "spark-3.5", "schedule": "0 2 * * *"}'::jsonb, now() - interval '80 days', now() - interval '35 days'),
    ('40000000-0000-0000-0000-000000000019', 'bi-reporting-server', 'application', 'prod', 'in_service', 'tier_2', '20000000-0000-0000-0000-000000000007', 'Tariq Mansoor', 'https://bi.enterprise.corp:8080', now() - interval '42 days', 'ITAM-APP-019', '{"tool": "superset", "cache_redis": true}'::jsonb, now() - interval '80 days', now() - interval '42 days'),
    ('40000000-0000-0000-0000-000000000020', 'swift-iso20022-connector', 'application', 'prod', 'in_service', 'tier_0', '20000000-0000-0000-0000-000000000002', 'Sarah Jenkins', 'tcp://swift-gw.prod.internal:14001', now() - interval '11 days', 'ITAM-APP-020', '{"protocol": "ISO20022", "encryption": "hsm"}'::jsonb, now() - interval '95 days', now() - interval '11 days'),
    ('40000000-0000-0000-0000-000000000021', 'audit-trail-collector', 'application', 'prod', 'in_service', 'tier_1', '20000000-0000-0000-0000-000000000005', 'David O''Connor', 'https://audit.sec.internal:8443', now() - interval '16 days', 'ITAM-APP-021', '{"storage": "immutable_wORM", "retention_yr": 7}'::jsonb, now() - interval '90 days', now() - interval '16 days'),
    ('40000000-0000-0000-0000-000000000022', 'payment-gateway-api-dr', 'application', 'dr', 'in_service', 'tier_0', '20000000-0000-0000-0000-000000000002', 'Sarah Jenkins', 'https://api-pay.dr.internal:8443', now() - interval '15 days', 'ITAM-APP-022', '{"runtime": "golang:1.23", "standby": true}'::jsonb, now() - interval '100 days', now() - interval '15 days'),
    ('40000000-0000-0000-0000-000000000023', 'payment-gateway-api-stage', 'application', 'staging', 'in_service', 'tier_3', '20000000-0000-0000-0000-000000000002', 'Sarah Jenkins', 'https://api-pay.staging.internal:8443', now() - interval '4 days', 'ITAM-APP-023', '{"environment": "staging", "mock_swift": true}'::jsonb, now() - interval '30 days', now() - interval '4 days'),
    ('40000000-0000-0000-0000-000000000024', 'legacy-monolith-cobol-bridge', 'application', 'prod', 'deprecated', 'tier_1', '20000000-0000-0000-0000-000000000002', 'Sarah Jenkins', 'tcp://mainframe.prod.internal:3270', now() - interval '85 days', 'ITAM-APP-024', '{"retirement_date": "2027-06-30", "status": "sunset"}'::jsonb, now() - interval '300 days', now() - interval '85 days'),
    ('40000000-0000-0000-0000-000000000025', 'retired-fax-notification-svc', 'application', 'prod', 'retired', 'tier_3', '20000000-0000-0000-0000-000000000006', 'Elena Rostova', 'tcp://fax01.retired:9999', now() - interval '150 days', 'ITAM-APP-025', '{"decommission_date": "2025-12-31"}'::jsonb, now() - interval '400 days', now() - interval '150 days'),

    -- Databases
    ('40000000-0000-0000-0000-000000000030', 'pg-ledger-primary-cluster', 'database', 'prod', 'in_service', 'tier_0', '20000000-0000-0000-0000-000000000004', 'Priya Patel', 'postgres://ledger-rw.db.prod.internal:5432/ledger', now() - interval '6 days', 'ITAM-DB-030', '{"engine": "PostgreSQL 16", "ha_mode": "patroni"}'::jsonb, now() - interval '120 days', now() - interval '6 days'),
    ('40000000-0000-0000-0000-000000000031', 'pg-ledger-read-replica-01', 'database', 'prod', 'in_service', 'tier_0', '20000000-0000-0000-0000-000000000004', 'Priya Patel', 'postgres://ledger-ro.db.prod.internal:5432/ledger', now() - interval '6 days', 'ITAM-DB-031', '{"engine": "PostgreSQL 16", "lag_bytes": 0}'::jsonb, now() - interval '120 days', now() - interval '6 days'),
    ('40000000-0000-0000-0000-000000000032', 'redis-token-session-cache', 'database', 'prod', 'in_service', 'tier_0', '20000000-0000-0000-0000-000000000001', 'Alex Chen', 'redis://redis-cluster.prod.internal:6379', now() - interval '8 days', 'ITAM-DB-032', '{"engine": "Redis 7.2 Cluster", "nodes": 6}'::jsonb, now() - interval '110 days', now() - interval '8 days'),
    ('40000000-0000-0000-0000-000000000033', 'kafka-event-bus-prod', 'database', 'prod', 'in_service', 'tier_0', '20000000-0000-0000-0000-000000000001', 'Alex Chen', 'kafka://kafka-broker.prod.internal:9092', now() - interval '10 days', 'ITAM-DB-033', '{"engine": "Kafka 3.7 KRaft", "partitions": 32}'::jsonb, now() - interval '110 days', now() - interval '10 days'),
    ('40000000-0000-0000-0000-000000000034', 'pg-accounts-db-prod', 'database', 'prod', 'in_service', 'tier_1', '20000000-0000-0000-0000-000000000004', 'Priya Patel', 'postgres://accounts.db.prod.internal:5432/accounts', now() - interval '12 days', 'ITAM-DB-034', '{"engine": "PostgreSQL 16", "pool_size": 100}'::jsonb, now() - interval '100 days', now() - interval '12 days'),
    ('40000000-0000-0000-0000-000000000035', 'clickhouse-analytics-olap', 'database', 'prod', 'in_service', 'tier_2', '20000000-0000-0000-0000-000000000007', 'Tariq Mansoor', 'clickhouse://ch.analytics.internal:9000', now() - interval '21 days', 'ITAM-DB-035', '{"engine": "ClickHouse 24.3", "compression": "zstd"}'::jsonb, now() - interval '80 days', now() - interval '21 days'),
    ('40000000-0000-0000-0000-000000000036', 'rabbitmq-notification-queue', 'database', 'prod', 'in_service', 'tier_2', '20000000-0000-0000-0000-000000000001', 'Alex Chen', 'amqp://rmq.prod.internal:5672', now() - interval '24 days', 'ITAM-DB-036', '{"engine": "RabbitMQ 3.13", "quorum_queues": true}'::jsonb, now() - interval '80 days', now() - interval '24 days'),
    ('40000000-0000-0000-0000-000000000037', 'pg-ledger-standby-dr', 'database', 'dr', 'in_service', 'tier_0', '20000000-0000-0000-0000-000000000004', 'Priya Patel', 'postgres://ledger.db.dr.internal:5432/ledger', now() - interval '15 days', 'ITAM-DB-037', '{"engine": "PostgreSQL 16", "sync_standby": true}'::jsonb, now() - interval '100 days', now() - interval '15 days'),
    ('40000000-0000-0000-0000-000000000038', 'redis-session-cache-stage', 'database', 'staging', 'in_service', 'tier_3', '20000000-0000-0000-0000-000000000001', 'Alex Chen', 'redis://redis.staging.internal:6379', now() - interval '5 days', 'ITAM-DB-038', '{"engine": "Redis 7.2 Standalone"}'::jsonb, now() - interval '30 days', now() - interval '5 days'),
    ('40000000-0000-0000-0000-000000000039', 'legacy-unmapped-sybase-db', 'database', 'prod', 'in_service', 'tier_2', '20000000-0000-0000-0000-000000000004', 'Priya Patel', 'sybase://syb01.prod.internal:5000/archive', now() - interval '80 days', 'ITAM-DB-039', '{"engine": "Sybase ASE 16", "note": "Orphan unmapped DB"}'::jsonb, now() - interval '180 days', now() - interval '80 days'),

    -- VM Clusters
    ('40000000-0000-0000-0000-000000000040', 'k8s-prod-us-east-core', 'vm_cluster', 'prod', 'in_service', 'tier_0', '20000000-0000-0000-0000-000000000001', 'Alex Chen', 'https://k8s-useast.infra.corp:6443', now() - interval '5 days', 'ITAM-VMC-040', '{"k8s_version": "v1.30.2", "nodes": 48}'::jsonb, now() - interval '150 days', now() - interval '5 days'),
    ('40000000-0000-0000-0000-000000000041', 'k8s-prod-eu-west-edge', 'vm_cluster', 'prod', 'in_service', 'tier_0', '20000000-0000-0000-0000-000000000001', 'Alex Chen', 'https://k8s-euwest.infra.corp:6443', now() - interval '7 days', 'ITAM-VMC-041', '{"k8s_version": "v1.30.2", "nodes": 32}'::jsonb, now() - interval '140 days', now() - interval '7 days'),
    ('40000000-0000-0000-0000-000000000042', 'k8s-dr-us-west-standby', 'vm_cluster', 'dr', 'in_service', 'tier_1', '20000000-0000-0000-0000-000000000001', 'Alex Chen', 'https://k8s-dr.infra.corp:6443', now() - interval '15 days', 'ITAM-VMC-042', '{"k8s_version": "v1.30.2", "nodes": 24}'::jsonb, now() - interval '120 days', now() - interval '15 days'),
    ('40000000-0000-0000-0000-000000000043', 'k8s-staging-sandbox', 'vm_cluster', 'staging', 'in_service', 'tier_3', '20000000-0000-0000-0000-000000000001', 'Alex Chen', 'https://k8s-stage.infra.corp:6443', now() - interval '3 days', 'ITAM-VMC-043', '{"k8s_version": "v1.31.0", "nodes": 12}'::jsonb, now() - interval '30 days', now() - interval '3 days'),
    ('40000000-0000-0000-0000-000000000044', 'vsphere-db-compute-pool', 'vm_cluster', 'prod', 'in_service', 'tier_0', '20000000-0000-0000-0000-000000000001', 'Alex Chen', 'https://vcenter.infra.corp/sdk', now() - interval '10 days', 'ITAM-VMC-044', '{"hypervisor": "ESXi 8.0u2", "ram_tb": 12}'::jsonb, now() - interval '160 days', now() - interval '10 days'),

    -- Physical Bare-Metal Hosts
    ('40000000-0000-0000-0000-000000000050', 'dc1-rack01-blade01-prod', 'physical_host', 'prod', 'in_service', 'tier_0', '20000000-0000-0000-0000-000000000003', 'Marcus Vance', 'ipmi://10.200.1.11', now() - interval '14 days', 'ITAM-HW-050', '{"vendor": "Dell PowerEdge R760", "cores": 128}'::jsonb, now() - interval '180 days', now() - interval '14 days'),
    ('40000000-0000-0000-0000-000000000051', 'dc1-rack01-blade02-prod', 'physical_host', 'prod', 'in_service', 'tier_0', '20000000-0000-0000-0000-000000000003', 'Marcus Vance', 'ipmi://10.200.1.12', now() - interval '14 days', 'ITAM-HW-051', '{"vendor": "Dell PowerEdge R760", "cores": 128}'::jsonb, now() - interval '180 days', now() - interval '14 days'),
    ('40000000-0000-0000-0000-000000000052', 'dc1-rack02-blade01-prod', 'physical_host', 'prod', 'in_service', 'tier_0', '20000000-0000-0000-0000-000000000003', 'Marcus Vance', 'ipmi://10.200.2.11', now() - interval '14 days', 'ITAM-HW-052', '{"vendor": "HPE ProLiant DL380", "cores": 96}'::jsonb, now() - interval '180 days', now() - interval '14 days'),
    ('40000000-0000-0000-0000-000000000053', 'dc2-dr-rack01-blade01', 'physical_host', 'dr', 'in_service', 'tier_1', '20000000-0000-0000-0000-000000000003', 'Marcus Vance', 'ipmi://10.201.1.11', now() - interval '15 days', 'ITAM-HW-053', '{"vendor": "Dell PowerEdge R660", "cores": 64}'::jsonb, now() - interval '150 days', now() - interval '15 days'),
    ('40000000-0000-0000-0000-000000000054', 'dc1-spare-storage-shelf-04', 'physical_host', 'prod', 'in_service', 'tier_3', '20000000-0000-0000-0000-000000000003', 'Marcus Vance', 'ipmi://10.200.9.99', now() - interval '95 days', 'ITAM-HW-054', '{"vendor": "NetApp FAS8300", "note": "Unmapped spare storage"}'::jsonb, now() - interval '200 days', now() - interval '95 days'),

    -- Network Firewalls & Perimeter
    ('40000000-0000-0000-0000-000000000060', 'perimeter-palo-alto-fw01', 'network_firewall', 'prod', 'in_service', 'tier_0', '20000000-0000-0000-0000-000000000005', 'David O''Connor', 'https://pa-fw01.mgmt.corp', now() - interval '8 days', 'ITAM-NET-060', '{"vendor": "Palo Alto PA-5450", "throughput": "100Gbps"}'::jsonb, now() - interval '180 days', now() - interval '8 days'),
    ('40000000-0000-0000-0000-000000000061', 'edge-cloudflare-waf-proxy', 'network_firewall', 'prod', 'in_service', 'tier_0', '20000000-0000-0000-0000-000000000005', 'David O''Connor', 'https://dash.cloudflare.com/enterprise', now() - interval '12 days', 'ITAM-NET-061', '{"ddos_protection": "enterprise_layer7", "anycast": true}'::jsonb, now() - interval '180 days', now() - interval '12 days'),
    ('40000000-0000-0000-0000-000000000062', 'transit-vpc-gateway-core', 'network_firewall', 'prod', 'in_service', 'tier_0', '20000000-0000-0000-0000-000000000001', 'Alex Chen', 'https://tgw.infra.corp', now() - interval '15 days', 'ITAM-NET-062', '{"bandwidth_gbps": 50, "bgp_asn": 65001}'::jsonb, now() - interval '150 days', now() - interval '15 days'),
    ('40000000-0000-0000-0000-000000000063', 'pci-dss-zone-firewall', 'network_firewall', 'prod', 'in_service', 'tier_0', '20000000-0000-0000-0000-000000000005', 'David O''Connor', 'https://pa-pci.mgmt.corp', now() - interval '6 days', 'ITAM-NET-063', '{"zone": "PCI-DSS-CDE", "ids_ips": "enabled"}'::jsonb, now() - interval '180 days', now() - interval '6 days'),

    -- VM Servers
    ('40000000-0000-0000-0000-000000000070', 'vm-db-pg-ledger-01', 'vm_server', 'prod', 'in_service', 'tier_0', '20000000-0000-0000-0000-000000000004', 'Priya Patel', 'ssh://10.100.1.10', now() - interval '6 days', 'ITAM-VM-070', '{"vcpus": 32, "ram_gb": 128}'::jsonb, now() - interval '120 days', now() - interval '6 days'),
    ('40000000-0000-0000-0000-000000000071', 'vm-db-pg-ledger-02', 'vm_server', 'prod', 'in_service', 'tier_0', '20000000-0000-0000-0000-000000000004', 'Priya Patel', 'ssh://10.100.1.11', now() - interval '6 days', 'ITAM-VM-071', '{"vcpus": 32, "ram_gb": 128}'::jsonb, now() - interval '120 days', now() - interval '6 days'),
    ('40000000-0000-0000-0000-000000000072', 'vm-kafka-broker-01', 'vm_server', 'prod', 'in_service', 'tier_0', '20000000-0000-0000-0000-000000000001', 'Alex Chen', 'ssh://10.100.2.10', now() - interval '10 days', 'ITAM-VM-072', '{"vcpus": 16, "ram_gb": 64}'::jsonb, now() - interval '110 days', now() - interval '10 days'),
    ('40000000-0000-0000-0000-000000000073', 'vm-kafka-broker-02', 'vm_server', 'prod', 'in_service', 'tier_0', '20000000-0000-0000-0000-000000000001', 'Alex Chen', 'ssh://10.100.2.11', now() - interval '10 days', 'ITAM-VM-073', '{"vcpus": 16, "ram_gb": 64}'::jsonb, now() - interval '110 days', now() - interval '10 days')
ON CONFLICT (ci_id) DO NOTHING;

-- ====================================================================
-- 5. Dependency Edges (72 Realistic Relationships & Handshakes)
-- ====================================================================
INSERT INTO ci_edges (id, source_ci_id, target_ci_id, edge_type, handshake_status, created_by, confirmed_by, confirmed_at, created_at, updated_at)
VALUES
    -- Business Service -> Core Applications (depends_on)
    ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000010', 'depends_on', 'confirmed', '30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', now() - interval '90 days', now() - interval '95 days', now() - interval '90 days'),
    ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000011', 'depends_on', 'confirmed', '30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', now() - interval '90 days', now() - interval '95 days', now() - interval '90 days'),
    ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000020', 'depends_on', 'confirmed', '30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', now() - interval '85 days', now() - interval '90 days', now() - interval '85 days'),
    ('50000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000010', 'depends_on', 'confirmed', '30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', now() - interval '90 days', now() - interval '95 days', now() - interval '90 days'),
    ('50000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000012', 'depends_on', 'confirmed', '30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000005', now() - interval '80 days', now() - interval '85 days', now() - interval '80 days'),

    -- Customer Portal & Mobile -> BFF Apps
    ('50000000-0000-0000-0000-000000000006', '40000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000015', 'depends_on', 'confirmed', '30000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000006', now() - interval '80 days', now() - interval '85 days', now() - interval '80 days'),
    ('50000000-0000-0000-0000-000000000007', '40000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000016', 'depends_on', 'confirmed', '30000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000006', now() - interval '80 days', now() - interval '85 days', now() - interval '80 days'),
    ('50000000-0000-0000-0000-000000000008', '40000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000018', 'depends_on', 'confirmed', '30000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000007', now() - interval '70 days', now() - interval '75 days', now() - interval '70 days'),
    ('50000000-0000-0000-0000-000000000009', '40000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000019', 'depends_on', 'confirmed', '30000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000007', now() - interval '70 days', now() - interval '75 days', now() - interval '70 days'),
    ('50000000-0000-0000-0000-000000000010', '40000000-0000-0000-0000-000000000006', '40000000-0000-0000-0000-000000000017', 'depends_on', 'confirmed', '30000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000006', now() - interval '70 days', now() - interval '75 days', now() - interval '70 days'),

    -- DR Standby Service
    ('50000000-0000-0000-0000-000000000011', '40000000-0000-0000-0000-000000000007', '40000000-0000-0000-0000-000000000022', 'depends_on', 'confirmed', '30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', now() - interval '80 days', now() - interval '85 days', now() - interval '80 days'),

    -- BFF -> Core APIs
    ('50000000-0000-0000-0000-000000000012', '40000000-0000-0000-0000-000000000015', '40000000-0000-0000-0000-000000000013', 'depends_on', 'confirmed', '30000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000005', now() - interval '75 days', now() - interval '80 days', now() - interval '75 days'),
    ('50000000-0000-0000-0000-000000000013', '40000000-0000-0000-0000-000000000015', '40000000-0000-0000-0000-000000000014', 'depends_on', 'confirmed', '30000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000002', now() - interval '75 days', now() - interval '80 days', now() - interval '75 days'),
    ('50000000-0000-0000-0000-000000000014', '40000000-0000-0000-0000-000000000015', '40000000-0000-0000-0000-000000000010', 'depends_on', 'confirmed', '30000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000002', now() - interval '75 days', now() - interval '80 days', now() - interval '75 days'),
    ('50000000-0000-0000-0000-000000000015', '40000000-0000-0000-0000-000000000016', '40000000-0000-0000-0000-000000000013', 'depends_on', 'confirmed', '30000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000005', now() - interval '75 days', now() - interval '80 days', now() - interval '75 days'),
    ('50000000-0000-0000-0000-000000000016', '40000000-0000-0000-0000-000000000016', '40000000-0000-0000-0000-000000000014', 'depends_on', 'confirmed', '30000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000002', now() - interval '75 days', now() - interval '80 days', now() - interval '75 days'),
    ('50000000-0000-0000-0000-000000000017', '40000000-0000-0000-0000-000000000016', '40000000-0000-0000-0000-000000000010', 'depends_on', 'confirmed', '30000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000002', now() - interval '75 days', now() - interval '80 days', now() - interval '75 days'),

    -- Payment Gateway -> Fraud, Auth, Ledger, Kafka, Redis
    ('50000000-0000-0000-0000-000000000018', '40000000-0000-0000-0000-000000000010', '40000000-0000-0000-0000-000000000012', 'depends_on', 'confirmed', '30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000005', now() - interval '80 days', now() - interval '85 days', now() - interval '80 days'),
    ('50000000-0000-0000-0000-000000000019', '40000000-0000-0000-0000-000000000010', '40000000-0000-0000-0000-000000000013', 'depends_on', 'confirmed', '30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000005', now() - interval '80 days', now() - interval '85 days', now() - interval '80 days'),
    ('50000000-0000-0000-0000-000000000020', '40000000-0000-0000-0000-000000000010', '40000000-0000-0000-0000-000000000011', 'depends_on', 'confirmed', '30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', now() - interval '85 days', now() - interval '90 days', now() - interval '85 days'),
    ('50000000-0000-0000-0000-000000000021', '40000000-0000-0000-0000-000000000010', '40000000-0000-0000-0000-000000000032', 'depends_on', 'confirmed', '30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', now() - interval '85 days', now() - interval '90 days', now() - interval '85 days'),
    ('50000000-0000-0000-0000-000000000022', '40000000-0000-0000-0000-000000000010', '40000000-0000-0000-0000-000000000033', 'connects_to', 'confirmed', '30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', now() - interval '80 days', now() - interval '85 days', now() - interval '80 days'),

    -- General Ledger Engine -> PostgreSQL Primary, Read Replica, Kafka
    ('50000000-0000-0000-0000-000000000023', '40000000-0000-0000-0000-000000000011', '40000000-0000-0000-0000-000000000030', 'depends_on', 'confirmed', '30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000004', now() - interval '90 days', now() - interval '95 days', now() - interval '90 days'),
    ('50000000-0000-0000-0000-000000000024', '40000000-0000-0000-0000-000000000011', '40000000-0000-0000-0000-000000000031', 'reads_from', 'confirmed', '30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000004', now() - interval '90 days', now() - interval '95 days', now() - interval '90 days'),
    ('50000000-0000-0000-0000-000000000025', '40000000-0000-0000-0000-000000000011', '40000000-0000-0000-0000-000000000033', 'connects_to', 'confirmed', '30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', now() - interval '85 days', now() - interval '90 days', now() - interval '85 days'),
    ('50000000-0000-0000-0000-000000000026', '40000000-0000-0000-0000-000000000011', '40000000-0000-0000-0000-000000000021', 'connects_to', 'confirmed', '30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000005', now() - interval '80 days', now() - interval '85 days', now() - interval '80 days'),

    -- Fraud Service -> Kafka, Redis
    ('50000000-0000-0000-0000-000000000027', '40000000-0000-0000-0000-000000000012', '40000000-0000-0000-0000-000000000033', 'reads_from', 'confirmed', '30000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000001', now() - interval '80 days', now() - interval '85 days', now() - interval '80 days'),
    ('50000000-0000-0000-0000-000000000028', '40000000-0000-0000-0000-000000000012', '40000000-0000-0000-0000-000000000032', 'reads_from', 'confirmed', '30000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000001', now() - interval '80 days', now() - interval '85 days', now() - interval '80 days'),

    -- Accounts API -> pg-accounts-db
    ('50000000-0000-0000-0000-000000000029', '40000000-0000-0000-0000-000000000014', '40000000-0000-0000-0000-000000000034', 'depends_on', 'confirmed', '30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000004', now() - interval '80 days', now() - interval '85 days', now() - interval '80 days'),

    -- Notification Dispatcher -> RabbitMQ
    ('50000000-0000-0000-0000-000000000030', '40000000-0000-0000-0000-000000000017', '40000000-0000-0000-0000-000000000036', 'depends_on', 'confirmed', '30000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000001', now() - interval '75 days', now() - interval '80 days', now() - interval '75 days'),

    -- Analytics -> ClickHouse & Kafka
    ('50000000-0000-0000-0000-000000000031', '40000000-0000-0000-0000-000000000018', '40000000-0000-0000-0000-000000000033', 'reads_from', 'confirmed', '30000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000001', now() - interval '70 days', now() - interval '75 days', now() - interval '70 days'),
    ('50000000-0000-0000-0000-000000000032', '40000000-0000-0000-0000-000000000018', '40000000-0000-0000-0000-000000000035', 'depends_on', 'confirmed', '30000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000007', now() - interval '70 days', now() - interval '75 days', now() - interval '70 days'),
    ('50000000-0000-0000-0000-000000000033', '40000000-0000-0000-0000-000000000019', '40000000-0000-0000-0000-000000000035', 'reads_from', 'confirmed', '30000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000007', now() - interval '70 days', now() - interval '75 days', now() - interval '70 days'),

    -- DR Standby Relationships
    ('50000000-0000-0000-0000-000000000034', '40000000-0000-0000-0000-000000000022', '40000000-0000-0000-0000-000000000037', 'depends_on', 'confirmed', '30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000004', now() - interval '75 days', now() - interval '80 days', now() - interval '75 days'),

    -- Application -> Kubernetes Clusters (hosted_on)
    ('50000000-0000-0000-0000-000000000035', '40000000-0000-0000-0000-000000000010', '40000000-0000-0000-0000-000000000040', 'hosted_on', 'confirmed', '30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', now() - interval '90 days', now() - interval '95 days', now() - interval '90 days'),
    ('50000000-0000-0000-0000-000000000036', '40000000-0000-0000-0000-000000000011', '40000000-0000-0000-0000-000000000040', 'hosted_on', 'confirmed', '30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', now() - interval '90 days', now() - interval '95 days', now() - interval '90 days'),
    ('50000000-0000-0000-0000-000000000037', '40000000-0000-0000-0000-000000000012', '40000000-0000-0000-0000-000000000040', 'hosted_on', 'confirmed', '30000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000001', now() - interval '90 days', now() - interval '95 days', now() - interval '90 days'),
    ('50000000-0000-0000-0000-000000000038', '40000000-0000-0000-0000-000000000013', '40000000-0000-0000-0000-000000000040', 'hosted_on', 'confirmed', '30000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000001', now() - interval '90 days', now() - interval '95 days', now() - interval '90 days'),
    ('50000000-0000-0000-0000-000000000039', '40000000-0000-0000-0000-000000000014', '40000000-0000-0000-0000-000000000040', 'hosted_on', 'confirmed', '30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', now() - interval '85 days', now() - interval '90 days', now() - interval '85 days'),
    ('50000000-0000-0000-0000-000000000040', '40000000-0000-0000-0000-000000000015', '40000000-0000-0000-0000-000000000041', 'hosted_on', 'confirmed', '30000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000001', now() - interval '85 days', now() - interval '90 days', now() - interval '85 days'),
    ('50000000-0000-0000-0000-000000000041', '40000000-0000-0000-0000-000000000016', '40000000-0000-0000-0000-000000000041', 'hosted_on', 'confirmed', '30000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000001', now() - interval '85 days', now() - interval '90 days', now() - interval '85 days'),
    ('50000000-0000-0000-0000-000000000042', '40000000-0000-0000-0000-000000000017', '40000000-0000-0000-0000-000000000040', 'hosted_on', 'confirmed', '30000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000001', now() - interval '80 days', now() - interval '85 days', now() - interval '80 days'),
    ('50000000-0000-0000-0000-000000000043', '40000000-0000-0000-0000-000000000018', '40000000-0000-0000-0000-000000000040', 'hosted_on', 'confirmed', '30000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000001', now() - interval '80 days', now() - interval '85 days', now() - interval '80 days'),
    ('50000000-0000-0000-0000-000000000044', '40000000-0000-0000-0000-000000000019', '40000000-0000-0000-0000-000000000040', 'hosted_on', 'confirmed', '30000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000001', now() - interval '80 days', now() - interval '85 days', now() - interval '80 days'),
    ('50000000-0000-0000-0000-000000000045', '40000000-0000-0000-0000-000000000021', '40000000-0000-0000-0000-000000000040', 'hosted_on', 'confirmed', '30000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000001', now() - interval '80 days', now() - interval '85 days', now() - interval '80 days'),
    ('50000000-0000-0000-0000-000000000046', '40000000-0000-0000-0000-000000000022', '40000000-0000-0000-0000-000000000042', 'hosted_on', 'confirmed', '30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', now() - interval '80 days', now() - interval '85 days', now() - interval '80 days'),
    ('50000000-0000-0000-0000-000000000047', '40000000-0000-0000-0000-000000000023', '40000000-0000-0000-0000-000000000043', 'hosted_on', 'confirmed', '30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', now() - interval '25 days', now() - interval '28 days', now() - interval '25 days'),

    -- Databases -> VM Servers (hosted_on)
    ('50000000-0000-0000-0000-000000000048', '40000000-0000-0000-0000-000000000030', '40000000-0000-0000-0000-000000000070', 'hosted_on', 'confirmed', '30000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000004', now() - interval '90 days', now() - interval '95 days', now() - interval '90 days'),
    ('50000000-0000-0000-0000-000000000049', '40000000-0000-0000-0000-000000000031', '40000000-0000-0000-0000-000000000071', 'hosted_on', 'confirmed', '30000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000004', now() - interval '90 days', now() - interval '95 days', now() - interval '90 days'),
    ('50000000-0000-0000-0000-000000000050', '40000000-0000-0000-0000-000000000033', '40000000-0000-0000-0000-000000000072', 'hosted_on', 'confirmed', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', now() - interval '85 days', now() - interval '90 days', now() - interval '85 days'),
    ('50000000-0000-0000-0000-000000000051', '40000000-0000-0000-0000-000000000034', '40000000-0000-0000-0000-000000000044', 'hosted_on', 'confirmed', '30000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001', now() - interval '85 days', now() - interval '90 days', now() - interval '85 days'),
    ('50000000-0000-0000-0000-000000000052', '40000000-0000-0000-0000-000000000035', '40000000-0000-0000-0000-000000000044', 'hosted_on', 'confirmed', '30000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000001', now() - interval '80 days', now() - interval '85 days', now() - interval '80 days'),

    -- VM Servers -> VM Cluster / Bare-Metal Hosts (hosted_on)
    ('50000000-0000-0000-0000-000000000053', '40000000-0000-0000-0000-000000000070', '40000000-0000-0000-0000-000000000044', 'hosted_on', 'confirmed', '30000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001', now() - interval '90 days', now() - interval '95 days', now() - interval '90 days'),
    ('50000000-0000-0000-0000-000000000054', '40000000-0000-0000-0000-000000000071', '40000000-0000-0000-0000-000000000044', 'hosted_on', 'confirmed', '30000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001', now() - interval '90 days', now() - interval '95 days', now() - interval '90 days'),
    ('50000000-0000-0000-0000-000000000055', '40000000-0000-0000-0000-000000000072', '40000000-0000-0000-0000-000000000044', 'hosted_on', 'confirmed', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', now() - interval '85 days', now() - interval '90 days', now() - interval '85 days'),
    ('50000000-0000-0000-0000-000000000056', '40000000-0000-0000-0000-000000000073', '40000000-0000-0000-0000-000000000044', 'hosted_on', 'confirmed', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', now() - interval '85 days', now() - interval '90 days', now() - interval '85 days'),

    -- Clusters -> Physical Hosts (hosted_on)
    ('50000000-0000-0000-0000-000000000057', '40000000-0000-0000-0000-000000000040', '40000000-0000-0000-0000-000000000050', 'hosted_on', 'confirmed', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', now() - interval '100 days', now() - interval '105 days', now() - interval '100 days'),
    ('50000000-0000-0000-0000-000000000058', '40000000-0000-0000-0000-000000000040', '40000000-0000-0000-0000-000000000051', 'hosted_on', 'confirmed', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', now() - interval '100 days', now() - interval '105 days', now() - interval '100 days'),
    ('50000000-0000-0000-0000-000000000059', '40000000-0000-0000-0000-000000000044', '40000000-0000-0000-0000-000000000052', 'hosted_on', 'confirmed', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', now() - interval '100 days', now() - interval '105 days', now() - interval '100 days'),
    ('50000000-0000-0000-0000-000000000060', '40000000-0000-0000-0000-000000000042', '40000000-0000-0000-0000-000000000053', 'hosted_on', 'confirmed', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', now() - interval '90 days', now() - interval '95 days', now() - interval '90 days'),

    -- Perimeter Network & Security -> Core Ingress
    ('50000000-0000-0000-0000-000000000061', '40000000-0000-0000-0000-000000000061', '40000000-0000-0000-0000-000000000060', 'connects_to', 'confirmed', '30000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000005', now() - interval '110 days', now() - interval '115 days', now() - interval '110 days'),
    ('50000000-0000-0000-0000-000000000062', '40000000-0000-0000-0000-000000000060', '40000000-0000-0000-0000-000000000062', 'connects_to', 'confirmed', '30000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000001', now() - interval '100 days', now() - interval '105 days', now() - interval '100 days'),
    ('50000000-0000-0000-0000-000000000063', '40000000-0000-0000-0000-000000000062', '40000000-0000-0000-0000-000000000063', 'connects_to', 'confirmed', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000005', now() - interval '100 days', now() - interval '105 days', now() - interval '100 days'),
    ('50000000-0000-0000-0000-000000000064', '40000000-0000-0000-0000-000000000063', '40000000-0000-0000-0000-000000000010', 'connects_to', 'confirmed', '30000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000002', now() - interval '90 days', now() - interval '95 days', now() - interval '90 days'),

    -- ================================================================
    -- Active Handshake Edge Cases (Pending, Mismatched, Rejected)
    -- ================================================================
    -- Pending Confirmation (Tests Handshake Inbox!)
    ('50000000-0000-0000-0000-000000000065', '40000000-0000-0000-0000-000000000014', '40000000-0000-0000-0000-000000000032', 'depends_on', 'pending_confirmation', '30000000-0000-0000-0000-000000000002', NULL, NULL, now() - interval '2 days', now() - interval '2 days'),
    ('50000000-0000-0000-0000-000000000066', '40000000-0000-0000-0000-000000000015', '40000000-0000-0000-0000-000000000032', 'depends_on', 'pending_confirmation', '30000000-0000-0000-0000-000000000006', NULL, NULL, now() - interval '3 days', now() - interval '3 days'),
    ('50000000-0000-0000-0000-000000000067', '40000000-0000-0000-0000-000000000016', '40000000-0000-0000-0000-000000000032', 'depends_on', 'pending_confirmation', '30000000-0000-0000-0000-000000000006', NULL, NULL, now() - interval '4 days', now() - interval '4 days'),
    ('50000000-0000-0000-0000-000000000068', '40000000-0000-0000-0000-000000000017', '40000000-0000-0000-0000-000000000033', 'reads_from', 'pending_confirmation', '30000000-0000-0000-0000-000000000006', NULL, NULL, now() - interval '5 days', now() - interval '5 days'),
    ('50000000-0000-0000-0000-000000000069', '40000000-0000-0000-0000-000000000020', '40000000-0000-0000-0000-000000000033', 'connects_to', 'pending_confirmation', '30000000-0000-0000-0000-000000000002', NULL, NULL, now() - interval '6 days', now() - interval '6 days'),

    -- Flagged Mismatch (Discrepancy / Version Incompatibility)
    ('50000000-0000-0000-0000-000000000070', '40000000-0000-0000-0000-000000000024', '40000000-0000-0000-0000-000000000011', 'depends_on', 'flagged_mismatch', '30000000-0000-0000-0000-000000000002', NULL, NULL, now() - interval '12 days', now() - interval '3 days'),
    ('50000000-0000-0000-0000-000000000071', '40000000-0000-0000-0000-000000000019', '40000000-0000-0000-0000-000000000034', 'reads_from', 'flagged_mismatch', '30000000-0000-0000-0000-000000000007', NULL, NULL, now() - interval '10 days', now() - interval '2 days'),

    -- Rejected Relationship
    ('50000000-0000-0000-0000-000000000072', '40000000-0000-0000-0000-000000000023', '40000000-0000-0000-0000-000000000030', 'depends_on', 'rejected', '30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000004', now() - interval '15 days', now() - interval '18 days', now() - interval '15 days')
ON CONFLICT (id) DO NOTHING;

-- ====================================================================
-- 6. CI Flags (Governance & Risk Issues)
-- ====================================================================
INSERT INTO ci_flags (id, ci_id, flagged_by, reason, status, created_at, resolved_at, resolved_by)
VALUES
    ('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000024', '30000000-0000-0000-0000-000000000005', 'Security Vulnerability: Deprecated COBOL bridge relies on unencrypted mainframe socket protocol.', 'open', now() - interval '8 days', NULL, NULL),
    ('60000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000039', '30000000-0000-0000-0000-000000000004', 'Orphaned Asset: Sybase archive DB has no active consuming services or recorded business owner.', 'open', now() - interval '5 days', NULL, NULL),
    ('60000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000030', '30000000-0000-0000-0000-000000000004', 'Planned OS kernel upgrade scheduled for weekend maintenance window.', 'resolved', now() - interval '30 days', now() - interval '28 days', '30000000-0000-0000-0000-000000000004')
ON CONFLICT (id) DO NOTHING;

-- ====================================================================
-- 7. Audit Logs (Rich Immutable Event Stream)
-- ====================================================================
INSERT INTO audit_logs (id, entity_type, entity_id, affected_owner_group_ids, actor_id, action, diff, created_at)
VALUES
    (
        '70000000-0000-0000-0000-000000000001',
        'system',
        '11111111-1111-1111-1111-111111111111',
        ARRAY['20000000-0000-0000-0000-000000000001'::uuid],
        '11111111-1111-1111-1111-111111111111',
        'create',
        '{"event": "system_bootstrap", "message": "Enterprise Configuration Management System initialized with enterprise domain models and security roles."}'::jsonb,
        now() - interval '120 days'
    ),
    (
        '70000000-0000-0000-0000-000000000002',
        'ci',
        '40000000-0000-0000-0000-000000000001',
        ARRAY['20000000-0000-0000-0000-000000000002'::uuid],
        '30000000-0000-0000-0000-000000000002',
        'create',
        '{"before": null, "after": {"name": "Core Banking & Settlement", "ci_class": "business_service", "environment": "prod", "criticality_tier": "tier_0"}}'::jsonb,
        now() - interval '100 days'
    ),
    (
        '70000000-0000-0000-0000-000000000003',
        'ci',
        '40000000-0000-0000-0000-000000000030',
        ARRAY['20000000-0000-0000-0000-000000000004'::uuid],
        '30000000-0000-0000-0000-000000000004',
        'create',
        '{"before": null, "after": {"name": "pg-ledger-primary-cluster", "ci_class": "database", "environment": "prod", "criticality_tier": "tier_0"}}'::jsonb,
        now() - interval '100 days'
    ),
    (
        '70000000-0000-0000-0000-000000000004',
        'edge',
        '50000000-0000-0000-0000-000000000023',
        ARRAY['20000000-0000-0000-0000-000000000002'::uuid, '20000000-0000-0000-0000-000000000004'::uuid],
        '30000000-0000-0000-0000-000000000004',
        'confirm',
        '{"source": "general-ledger-engine", "target": "pg-ledger-primary-cluster", "handshake": "confirmed", "note": "Database team verified high-throughput connection pool authorization."}'::jsonb,
        now() - interval '90 days'
    ),
    (
        '70000000-0000-0000-0000-000000000005',
        'ci',
        '40000000-0000-0000-0000-000000000030',
        ARRAY['20000000-0000-0000-0000-000000000004'::uuid],
        '30000000-0000-0000-0000-000000000004',
        'verify',
        '{"action": "attestation", "verifier": "Priya Patel", "status": "verified_compliant", "check": "Quarterly disaster recovery replication verification succeeded."}'::jsonb,
        now() - interval '6 days'
    ),
    (
        '70000000-0000-0000-0000-000000000006',
        'ci',
        '40000000-0000-0000-0000-000000000024',
        ARRAY['20000000-0000-0000-0000-000000000002'::uuid, '20000000-0000-0000-0000-000000000005'::uuid],
        '30000000-0000-0000-0000-000000000005',
        'flag',
        '{"flag_id": "60000000-0000-0000-0000-000000000001", "reason": "Security Vulnerability: Deprecated COBOL bridge relies on unencrypted mainframe socket protocol."}'::jsonb,
        now() - interval '8 days'
    ),
    (
        '70000000-0000-0000-0000-000000000007',
        'edge',
        '50000000-0000-0000-0000-000000000072',
        ARRAY['20000000-0000-0000-0000-000000000002'::uuid, '20000000-0000-0000-0000-000000000004'::uuid],
        '30000000-0000-0000-0000-000000000004',
        'disconnect',
        '{"source": "payment-gateway-api-stage", "target": "pg-ledger-primary-cluster", "reason": "Staging application attempted unauthorized connection to production database. Rejected."}'::jsonb,
        now() - interval '15 days'
    )
ON CONFLICT (id) DO NOTHING;

-- ====================================================================
-- 8. Baselines
-- ====================================================================
INSERT INTO baselines (id, campaign_id, owner_group_id, version_tag, snapshot, published_by, published_at)
VALUES
    (
        '80000000-0000-0000-0000-000000000001',
        NULL,
        '20000000-0000-0000-0000-000000000002',
        'v1.0.0-Q3-Certified',
        '{"cis_count": 8, "edges_count": 14, "certification": "SOC2_Type_II", "published_by": "Sarah Jenkins"}'::jsonb,
        '30000000-0000-0000-0000-000000000002',
        now() - interval '60 days'
    )
ON CONFLICT (id) DO NOTHING;

-- ====================================================================
-- 9. Intake Campaigns, Invitations & Submissions
-- ====================================================================
INSERT INTO intake_campaigns (id, title, status, deadline, created_by, created_at)
VALUES
    ('90000000-0000-0000-0000-000000000001', 'Q4 2026 Enterprise Disaster Recovery Topology Audit', 'active', now() + interval '30 days', '11111111-1111-1111-1111-111111111111', now() - interval '10 days'),
    ('90000000-0000-0000-0000-000000000002', 'H1 2026 PCI-DSS Service Boundary Attestation', 'closed', now() - interval '45 days', '11111111-1111-1111-1111-111111111111', now() - interval '90 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO intake_invitations (id, campaign_id, owner_group_id, token_hash, raw_token, team_lead_email, status, expires_at, last_accessed_at, created_at)
VALUES
    ('91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', encode(sha256('intake-token-banking-q4'), 'hex'), 'intake-token-banking-q4', 'sarah.jenkins@enterprise.com', 'opened', now() + interval '30 days', now() - interval '1 day', now() - interval '10 days'),
    ('91000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004', encode(sha256('intake-token-dba-q4'), 'hex'), 'intake-token-dba-q4', 'priya.patel@enterprise.com', 'submitted', now() + interval '30 days', now() - interval '2 days', now() - interval '10 days'),
    ('91000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', encode(sha256('intake-token-platform-q4'), 'hex'), 'intake-token-platform-q4', 'alex.chen@enterprise.com', 'sent', now() + interval '30 days', NULL, now() - interval '10 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO intake_submissions (id, invitation_id, owner_group_id, status, payload, lock_version, submitted_at, created_at)
VALUES
    ('92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000004', 'approved', '{"services_verified": 6, "standby_tested": true, "notes": "Disaster recovery failover tested successfully in US-West DR region."}'::jsonb, 1, now() - interval '2 days', now() - interval '5 days')
ON CONFLICT (id) DO NOTHING;

-- ====================================================================
-- 10. Digest Cycles & Items (Freshness & Attestation Workflows)
-- ====================================================================
INSERT INTO digest_cycles (id, owner_group_id, window_start, window_end, status, created_at, closed_at)
VALUES
    ('a0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', now() - interval '30 days', now(), 'open', now() - interval '30 days', NULL),
    ('a0000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000004', now() - interval '60 days', now() - interval '30 days', 'closed', now() - interval '60 days', now() - interval '30 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO digest_items (id, cycle_id, ci_id, trigger_reason, status, actioned_at, action_type, created_at)
VALUES
    ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000024', 'verification_due', 'open', NULL, NULL, now() - interval '10 days'),
    ('a1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000030', 'quarterly_reverification', 'actioned', now() - interval '32 days', 'verified', now() - interval '45 days'),
    ('a1000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000031', 'quarterly_reverification', 'actioned', now() - interval '32 days', 'verified', now() - interval '45 days')
ON CONFLICT (id) DO NOTHING;

COMMIT;
